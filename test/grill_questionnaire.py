"""Behavioral checks against the real HTTP server, always in an isolated home."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / 'artifacts/1.19.1/skills/internal/grill-with-docs'
spec = importlib.util.spec_from_file_location('questionnaire', SKILL / 'scripts/questionnaire.py')
grill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grill)


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


if __name__ == '__main__':
    unittest.main()
