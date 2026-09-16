"""Behavioral checks against the real HTTP server, always in an isolated home."""
from copy import deepcopy
import base64
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
SKILL = ROOT / 'artifacts/1.22.1/skills/internal/grill-with-docs'
spec = importlib.util.spec_from_file_location('questionnaire', SKILL / 'scripts/questionnaire.py')
grill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grill)
LEGACY_SKILL = ROOT / 'artifacts/1.22.0/skills/internal/grill-with-docs'
legacy_spec = importlib.util.spec_from_file_location('legacy_questionnaire', LEGACY_SKILL / 'scripts/questionnaire.py')
legacy_grill = importlib.util.module_from_spec(legacy_spec)
legacy_spec.loader.exec_module(legacy_grill)


class QuestionnaireBehavior(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='grill-qa-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.raw = json.loads((SKILL / 'references/questions.example.json').read_text())
        self.directory, self.config = grill.prepare(self.raw, self.home)
        self.server = grill.make_server(self.directory, self.config)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.stop)
        self.origin = f'http://127.0.0.1:{self.server.server_port}'
        self.url = self.origin + self.server.prefix
        self.data = dict(sessionId=self.config['sessionId'], version=1,
                         questionnaireHash=self.config['questionnaireHash'], generalNotes='  Matiz\npendiente.  ',
                         answers=[dict(id=q['id'], choice='', note='', deferred=False) for q in self.config['questions']])
        self.data['answers'][0].update(choice='B', note='  No es definitivo.\nQuizá sí.  ')
        self.data['answers'][1]['deferred'] = True

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()

    def request(self, data=None, revision=0, origin=None, path='answers'):
        body = None if data is None else json.dumps(dict(expectedRevision=revision, data=data)).encode()
        headers = {'Content-Type': 'application/json', 'Origin': origin or self.origin}
        try:
            with urlopen(Request(self.url + path, body, headers), timeout=5) as response:
                return response.status, response.read()
        except HTTPError as error:
            with error:
                return error.code, error.read()

    def test_submit_preserves_literal_partial_answers_and_receipt(self):
        status, body = self.request(self.data)
        self.assertEqual(status, 200)
        receipt = json.loads(body)['receipt']
        saved = json.loads((self.directory / 'responses.json').read_text())
        self.assertEqual(saved['data']['answers'][0]['note'], self.data['answers'][0]['note'])
        self.assertTrue(saved['data']['answers'][1]['deferred'])
        self.assertEqual(saved['data']['generalNotes'], self.data['generalNotes'])
        self.assertEqual(saved, json.loads((self.directory / 'submissions' / (receipt + '.json')).read_text()))
        grill.prepare(self.raw, self.home)
        self.assertEqual(saved, json.loads(self.request()[1]))

    def test_stale_tabs_cannot_silently_overwrite(self):
        self.assertEqual(self.request(self.data)[0], 200)
        edited = deepcopy(self.data)
        edited['answers'][0]['note'] = 'New draft'
        self.assertEqual(self.request(edited, revision=0)[0], 409)
        self.assertEqual(json.loads(self.request()[1])['data']['answers'][0]['note'], self.data['answers'][0]['note'])
        self.assertEqual(self.request(edited, revision=1)[0], 200)
        self.assertEqual(len(list((self.directory / 'submissions').glob('*.json'))), 2)

    def test_changed_questions_require_new_round_and_preserve_previous(self):
        self.request(self.data)
        before = (self.directory / 'responses.json').read_bytes()
        changed = deepcopy(self.raw)
        changed['questions'][0]['text'] = 'Another question'
        with self.assertRaisesRegex(ValueError, 'new id'):
            grill.prepare(changed, self.home)
        changed['id'] = 'grill-demo-ronda-2'
        directory, _ = grill.prepare(changed, self.home)
        self.assertFalse((directory / 'responses.json').exists())
        self.assertEqual(before, (self.directory / 'responses.json').read_bytes())

    def test_foreign_origin_wrong_questionnaire_and_unpublished_paths_are_rejected(self):
        self.assertEqual(self.request(self.data, origin='https://another.example')[0], 403)
        bad = deepcopy(self.data)
        bad['questionnaireHash'] = 'wrong'
        self.assertEqual(self.request(bad)[0], 400)
        bad = deepcopy(self.data)
        bad['answers'][0]['choice'] = 'unknown'
        self.assertEqual(self.request(bad)[0], 400)
        self.assertEqual(self.request(path='../../questions.json')[0], 404)
        self.assertFalse((self.directory / 'responses.json').exists())

    def test_question_text_is_escaped_and_cannot_inject_template_or_script(self):
        raw = deepcopy(self.raw)
        raw['questions'][0]['text'] = '</script><img src=x onerror=alert(1)> @@SCRIPT@@'
        page = grill.render(grill.normalize_questions(raw))
        self.assertNotIn('</script><img', page)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt; @@SCRIPT@@', page)
        self.assertIn('\\u003c/script>', page)

    def test_free_text_question_has_no_empty_choice_instruction_or_clear_control(self):
        page = grill.render(grill.normalize_questions(self.raw))
        free_text = page.split('id="q-comentario"', 1)[1].split('</section>', 1)[0]
        self.assertNotIn('Elige una opción', free_text)
        self.assertNotIn('Quitar elección', free_text)
        self.assertIn('id="details-comentario" open', free_text)

    def test_local_visual_reference_is_embedded_with_accessible_purpose(self):
        image = self.home / 'compact-record.png'
        image.write_bytes(base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
        raw = deepcopy(self.raw)
        raw['id'] = 'grill-demo-visual-reference'
        raw['questions'][0]['references'] = [{
            'id': 'compact-record',
            'imagePath': image.name,
            'alt': 'Expediente compacto con una jerarquía clínica visible',
            'title': 'Densidad clínica',
            'caption': 'La tarea principal conserva espacio y los datos urgentes permanecen visibles.',
            'function': 'Densidad y jerarquía',
            'sourceUrl': 'https://example.test/compact-record',
        }]
        directory, config = grill.prepare(raw, self.home / 'media-home', self.home)
        page = (directory / 'index.html').read_text()
        canonical = json.loads((directory / 'questions.json').read_text())
        reference = canonical['questions'][0]['references'][0]
        self.assertIn('data:image/png;base64,', page)
        self.assertIn('Expediente compacto con una jerarquía clínica visible', page)
        self.assertIn('Densidad y jerarquía', page)
        self.assertIn('https://example.test/compact-record', page)
        self.assertNotIn(str(image), page)
        self.assertEqual(reference['sourceName'], image.name)
        self.assertEqual(config['questionnaireHash'], canonical['questionnaireHash'])

    def test_visual_reference_rejects_active_or_unbounded_media(self):
        image = self.home / 'active.svg'
        image.write_text('<svg onload="alert(1)"></svg>')
        raw = deepcopy(self.raw)
        raw['id'] = 'grill-demo-invalid-reference'
        raw['questions'][0]['references'] = [{
            'id': 'active-media',
            'imagePath': image.name,
            'alt': 'Referencia insegura',
            'function': 'Composición',
        }]
        with self.assertRaisesRegex(ValueError, 'only PNG, JPEG, GIF or WebP'):
            grill.prepare(raw, self.home / 'invalid-home', self.home)

        oversized = self.home / 'oversized.png'
        oversized.write_bytes(b'\x89PNG\r\n\x1a\n' + b'0' * grill.MAX_IMAGE_BYTES)
        raw['id'] = 'grill-demo-oversized-reference'
        raw['questions'][0]['references'][0]['imagePath'] = oversized.name
        with self.assertRaisesRegex(ValueError, 'image must contain'):
            grill.prepare(raw, self.home / 'oversized-home', self.home)

    def test_upgrade_reopens_a_legacy_round_without_hash_or_response_drift(self):
        home = self.home / 'legacy-home'
        directory, old_config = legacy_grill.prepare(self.raw, home)
        saved = {
            'revision': 1,
            'receipt': 'legacy-receipt',
            'receivedAt': '2026-09-15T00:00:00+00:00',
            'data': {
                'sessionId': old_config['sessionId'],
                'version': old_config['version'],
                'questionnaireHash': old_config['questionnaireHash'],
                'answers': [
                    {
                        'id': question['id'],
                        'title': question['title'],
                        'options': question['options'],
                        'choice': 'B' if index == 0 else '',
                        'note': 'Respuesta anterior literal.' if index == 0 else '',
                        'deferred': index == 1,
                    }
                    for index, question in enumerate(old_config['questions'])
                ],
                'generalNotes': 'Respuesta anterior literal.',
            },
        }
        legacy_grill.write_json(directory / 'responses.json', saved)
        before = (directory / 'responses.json').read_bytes()
        reopened, new_config = grill.prepare(self.raw, home)
        self.assertEqual(new_config['questionnaireHash'], old_config['questionnaireHash'])
        self.assertEqual(json.loads((reopened / 'questions.json').read_text()), old_config)
        self.assertEqual((reopened / 'responses.json').read_bytes(), before)

    def test_embedded_reference_recovers_after_source_disappears_and_rejects_definition_drift(self):
        image = self.home / 'recoverable.png'
        image.write_bytes(base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
        raw = deepcopy(self.raw)
        raw['id'] = 'grill-demo-recoverable-reference'
        raw['questions'][0]['references'] = [{
            'id': 'recoverable',
            'imagePath': image.name,
            'alt': 'Referencia recuperable',
            'caption': 'La copia canónica sobrevive al archivo fuente.',
            'function': 'Jerarquía',
        }]
        directory, original = grill.prepare(raw, self.home / 'recoverable-home', self.home)
        canonical_before = (directory / 'questions.json').read_bytes()
        image.unlink()
        reopened, recovered = grill.prepare(raw, self.home / 'recoverable-home', self.home)
        self.assertEqual(recovered, original)
        self.assertEqual((reopened / 'questions.json').read_bytes(), canonical_before)
        self.assertIn('data:image/png;base64,', (reopened / 'index.html').read_text())

        changed = deepcopy(raw)
        changed['questions'][0]['references'][0]['caption'] = 'Definición cambiada.'
        with self.assertRaisesRegex(ValueError, 'new id'):
            grill.prepare(changed, self.home / 'recoverable-home', self.home)


if __name__ == '__main__':
    unittest.main()
