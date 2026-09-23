#!/usr/bin/env python3
"""Render the shared grill template, serve one questionnaire, save literal answers."""
import argparse
import base64
import fcntl
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import html
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
from urllib.parse import urlsplit
import uuid

ASSETS = Path(__file__).resolve().parent.parent / 'assets'
SAFE_ID = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,79}\Z')
MAX_BODY = 2_000_000
MAX_IMAGE_BYTES = 5_000_000
MAX_MEDIA_BYTES = 12_000_000


def text(value, label, limit=12000, required=False):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError(f'{label}: expected {"nonempty " if required else ""}text up to {limit} characters')
    return value


def identifier(value, label):
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
        raise ValueError(f'{label}: use a letter followed by letters, numbers, hyphens or underscores')
    return value


def raster_data(path, label):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f'{label}: expected a regular local raster image')
    data = path.read_bytes()
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError(f'{label}: image must contain 1–{MAX_IMAGE_BYTES} bytes')
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif data.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif data.startswith((b'GIF87a', b'GIF89a')):
        mime = 'image/gif'
    elif len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        mime = 'image/webp'
    else:
        raise ValueError(f'{label}: only PNG, JPEG, GIF or WebP raster images are allowed')
    return f'data:{mime};base64,{base64.b64encode(data).decode()}', len(data)


def normalize_reference(raw, label, source_directory, embed_media=True):
    if not isinstance(raw, dict):
        raise ValueError(f'{label}: expected an object')
    image = text(raw.get('imagePath'), f'{label}.imagePath', 2000, True)
    path = Path(image).expanduser()
    source_url = text(raw.get('sourceUrl', ''), f'{label}.sourceUrl', 2000)
    if source_url and urlsplit(source_url).scheme not in ('http', 'https'):
        raise ValueError(f'{label}.sourceUrl: use an http or https URL')
    reference = dict(id=identifier(raw.get('id'), f'{label}.id'),
                     title=text(raw.get('title', ''), f'{label}.title', 200),
                     alt=text(raw.get('alt'), f'{label}.alt', 500, True),
                     caption=text(raw.get('caption', ''), f'{label}.caption', 2000),
                     function=text(raw.get('function'), f'{label}.function', 500, True),
                     sourceUrl=source_url, sourceName=path.name)
    if not embed_media:
        return reference, 0
    if not path.is_absolute():
        if source_directory is None:
            raise ValueError(f'{label}.imagePath: relative paths require the question JSON directory')
        path = source_directory / path
    reference['dataUrl'], byte_count = raster_data(path, f'{label}.imagePath')
    return reference, byte_count


def normalize_questions(raw, source_directory=None, embed_media=True):
    if not isinstance(raw, dict):
        raise ValueError('Questions must be a JSON object')
    key = identifier(raw.get('id'), 'id')
    title = text(raw.get('title'), 'title', 200, True)
    questions = raw.get('questions')
    if not isinstance(questions, list) or not 1 <= len(questions) <= 200:
        raise ValueError('Provide 1–200 questions')
    seen = set()
    media_bytes = 0
    normalized = []
    for q in questions:
        if not isinstance(q, dict):
            raise ValueError('Each question must be an object')
        ident = identifier(q.get('id'), 'question.id')
        if ident in seen:
            raise ValueError(f'Duplicate question: {ident}')
        seen.add(ident)
        options = q.get('options', {})
        if not isinstance(options, dict) or len(options) > 12:
            raise ValueError(f'{ident}: options must be an object with up to 12 entries')
        options = {identifier(k, 'option key'): text(v, 'option', 3000, True) for k, v in options.items()}
        raw_references = q.get('references', [])
        if not isinstance(raw_references, list) or len(raw_references) > 8:
            raise ValueError(f'{ident}: references must be an array with up to 8 entries')
        references = []
        reference_ids = set()
        for index, raw_reference in enumerate(raw_references, 1):
            reference, byte_count = normalize_reference(raw_reference, f'{ident}.references[{index}]', source_directory, embed_media)
            if reference['id'] in reference_ids:
                raise ValueError(f'{ident}: duplicate reference {reference["id"]}')
            reference_ids.add(reference['id'])
            media_bytes += byte_count
            if media_bytes > MAX_MEDIA_BYTES:
                raise ValueError(f'Questionnaire images exceed {MAX_MEDIA_BYTES} bytes')
            references.append(reference)
        normalized_question = dict(id=ident, title=text(q.get('text'), 'question.text', 1000, True),
                                   group=text(q.get('group', 'Preguntas'), 'group', 120, True),
                                   context=text(q.get('context', ''), 'context', 6000), options=options,
                                   recommendation=text(q.get('recommendation', ''), 'recommendation', 6000))
        # Preserve the pre-1.22.1 canonical shape when a question has no media.
        if references:
            normalized_question['references'] = references
        normalized.append(normalized_question)
    config = dict(version=1, sessionId=key, title=title,
                  productName=text(raw.get('productName', 'Grill with Docs'), 'productName', 100, True),
                  introduction=text(raw.get('introduction', 'Lee, elige y añade tus comentarios. Después de enviar, vuelve al chat y avisa que ya contestaste.'), 'introduction'),
                  questions=normalized)
    config['questionnaireHash'] = hashlib.sha256(json.dumps(config, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return config


def render(config):
    esc = html.escape
    nav, sections, groups = [], [], set()
    for i, q in enumerate(config['questions'], 1):
        ident = q['id']
        if q['group'] not in groups:
            nav.append(f'<a href="#q-{ident}"><span>{i:02}</span>{esc(q["group"])}</a>')
            groups.add(q['group'])
        options = ''.join(f'<label class="option"><input type="radio" name="answer-{ident}" value="{k}"><span class="letter" aria-hidden="true">{k}</span><span>{esc(v)}</span></label>' for k, v in q['options'].items())
        choice_field = f'<fieldset><legend>Elige una opción o escribe tu propia respuesta.</legend><div class="options">{options}</div></fieldset>' if q['options'] else ''
        clear_choice = f'<button type="button" class="compact-action" data-clear="{ident}">Quitar elección</button>' if q['options'] else ''
        recommendation = f'<p class="recommendation"><strong>Mi recomendación</strong>{esc(q["recommendation"])}</p>' if q['recommendation'] else ''
        references = []
        for reference in q.get('references', []):
            title = f'<strong>{esc(reference["title"])}</strong>' if reference['title'] else ''
            caption = f'<p>{esc(reference["caption"])}</p>' if reference['caption'] else ''
            source = f'<a href="{esc(reference["sourceUrl"], quote=True)}" target="_blank" rel="noreferrer">Abrir fuente</a>' if reference['sourceUrl'] else ''
            references.append(f'''<figure class="visual-reference" data-reference-id="{esc(reference['id'], quote=True)}">
<img src="{esc(reference['dataUrl'], quote=True)}" alt="{esc(reference['alt'], quote=True)}" loading="lazy"><figcaption>{title}{caption}<p class="reference-function"><span>Qué aporta</span>{esc(reference['function'])}</p>{source}</figcaption></figure>''')
        reference_gallery = f'<div class="reference-gallery" aria-label="Referencias visuales">{"".join(references)}</div>' if references else ''
        sections.append(f'''<section class="question" id="q-{ident}" data-question-id="{ident}" aria-labelledby="title-{ident}" tabindex="-1">
<p class="group-label">{esc(q['group'])} · {i} de {len(config['questions'])}</p><h2 id="title-{ident}">{i}. {esc(q['title'])}</h2>
<p class="question-context">{esc(q['context'])}</p>{reference_gallery}{choice_field}{recommendation}
<details id="details-{ident}" {"open" if not q["options"] else ""}><summary>Mi respuesta, matiz o ejemplo</summary><label class="sr-only" for="note-{ident}">Comentario: {esc(q['title'])}</label><textarea id="note-{ident}" name="note-{ident}" rows="3" maxlength="6000" placeholder="Puedes combinar opciones, proponer algo distinto o contar un caso real."></textarea></details>
<div class="question-actions"><button type="button" class="compact-action" data-defer="{ident}" aria-pressed="false">Dejar para después</button>{clear_choice}</div><p class="answer-state" id="state-{ident}">Sin responder</p></section>''')
    data = json.dumps(config, ensure_ascii=False).replace('<', '\\u003c').replace('&', '\\u0026')
    values = dict(TITLE=esc(config['title']), PRODUCT=esc(config['productName']), ID=esc(config['sessionId']),
                  INTRO=esc(config['introduction']), COUNT=str(len(config['questions'])),
                  NAV=''.join(nav), QUESTIONS=''.join(sections), DATA=data,
                  SCRIPT=(ASSETS / 'client.js').read_text())
    # Single substitution pass: question text cannot introduce template directives.
    return re.sub(r'@@([A-Z]+)@@', lambda m: values[m[1]], (ASSETS / 'questionnaire.html').read_text())


def regular(path):
    if path.is_symlink() or (path.exists() and (not path.is_file() or path.stat().st_nlink != 1)):
        raise ValueError(f'Refusing non-regular file: {path}')
    return path


def write_json(path, data):
    regular(path)
    fd, temp = tempfile.mkstemp(prefix='.saving-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def question_definition(config):
    definition = {key: config[key] for key in ['version', 'sessionId', 'title', 'productName', 'introduction']}
    definition['questions'] = []
    for question in config['questions']:
        item = {key: question[key] for key in ['id', 'title', 'group', 'context', 'options', 'recommendation']}
        if question.get('references'):
            item['references'] = [
                {key: reference[key] for key in ['id', 'title', 'alt', 'caption', 'function', 'sourceUrl', 'sourceName']}
                for reference in question['references']
            ]
        definition['questions'].append(item)
    return definition


def prepare(raw, home, source_directory=None):
    definition = normalize_questions(raw, source_directory, embed_media=False)
    key = definition['sessionId']
    directory = home.resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ['.development-system', 'private', 'questionnaires', key]:
        directory = directory / name
        if directory.is_symlink():
            raise ValueError(f'Refusing symlinked questionnaire directory: {directory}')
        directory.mkdir(mode=0o700, exist_ok=True)
    canonical = regular(directory / 'questions.json')
    if canonical.exists():
        config = json.loads(canonical.read_text())
        if question_definition(config) != question_definition(definition):
            raise ValueError('This questionnaire ID already has different questions. Use a new id for a new round.')
    else:
        config = normalize_questions(raw, source_directory, embed_media=True)
        write_json(canonical, config)
    regular(directory / 'index.html').write_text(render(config))
    return directory, config


def validate_answers(data, config):
    if not isinstance(data, dict) or any(data.get(k) != config[k] for k in ['sessionId', 'version', 'questionnaireHash']):
        raise ValueError('Las respuestas corresponden a otro cuestionario.')
    answers = data.get('answers')
    if not isinstance(answers, list) or len(answers) != len(config['questions']):
        raise ValueError('Faltan entradas del cuestionario; las respuestas pueden quedar vacías.')
    questions = {q['id']: q for q in config['questions']}
    seen, normalized = set(), []
    for a in answers:
        if not isinstance(a, dict) or not isinstance(a.get('id'), str) or a['id'] not in questions or a['id'] in seen:
            raise ValueError('Pregunta no válida o duplicada.')
        q = questions[a['id']]
        seen.add(a['id'])
        choice = a.get('choice')
        if not isinstance(choice, str) or (choice and choice not in q['options']):
            raise ValueError('Opción no válida.')
        note = text(a.get('note'), 'Comentario', 6000)
        if not isinstance(a.get('deferred'), bool):
            raise ValueError('Estado de respuesta no válido.')
        normalized.append(dict(id=a['id'], title=q['title'], options=q['options'], choice=choice, note=note, deferred=a['deferred']))
    notes = text(data.get('generalNotes'), 'Notas generales')
    if not any(a['choice'] or a['note'].strip() or a['deferred'] for a in normalized) and not notes.strip():
        raise ValueError('Todavía no hay respuestas que guardar.')
    return dict(sessionId=config['sessionId'], version=config['version'], questionnaireHash=config['questionnaireHash'],
                answers=normalized, generalNotes=notes)


def make_server(directory, config, port=0):
    prefix = '/s/' + secrets.token_urlsafe(24) + '/'
    origins, lock = set(), threading.Lock()
    def state():
        path = regular(directory / 'responses.json')
        return json.loads(path.read_text()) if path.exists() else dict(revision=0, data=None)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def send(self, status, body, mime='application/json; charset=utf-8'):
            raw = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            for k, v in {'Content-Type': mime, 'Content-Length': str(len(raw)), 'Cache-Control': 'no-store',
                         'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
                         'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(raw)
        def trusted_host(self):
            return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')
        def do_GET(self):
            if not self.trusted_host():
                return self.send(403, dict(error='Host no permitido.'))
            path = urlsplit(self.path).path
            if path == prefix:
                return self.send(200, (directory / 'index.html').read_bytes(), 'text/html; charset=utf-8')
            if path == prefix + 'answers':
                with lock:
                    return self.send(200, state())
            self.send(404, dict(error='Ruta no disponible.'))
        def do_POST(self):
            if not self.trusted_host() or self.headers.get('Origin') not in origins:
                return self.send(403, dict(error='Origen no permitido.'))
            if self.path != prefix + 'answers':
                return self.send(404, dict(error='Ruta no disponible.'))
            if self.headers.get_content_type() != 'application/json':
                return self.send(415, dict(error='Formato no permitido.'))
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= MAX_BODY:
                    return self.send(413, dict(error='Respuesta demasiado grande.'))
                self.connection.settimeout(15)
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict) or type(payload.get('expectedRevision')) is not int:
                    raise ValueError('Revisión no válida.')
                data = validate_answers(payload.get('data'), config)
                with lock:
                    current = state()
                    if payload['expectedRevision'] != current['revision']:
                        return self.send(409, dict(error='Otra pestaña guardó respuestas. Conserva tu borrador o recupera la copia guardada.'))
                    receipt = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:12]
                    result = dict(revision=current['revision'] + 1, receipt=receipt,
                                  receivedAt=datetime.now(timezone.utc).isoformat(), data=data)
                    receipts = directory / 'submissions'
                    if receipts.is_symlink():
                        raise ValueError('Directorio de respuestas no válido.')
                    receipts.mkdir(mode=0o700, exist_ok=True)
                    write_json(receipts / (receipt + '.json'), result)
                    write_json(directory / 'responses.json', result)
                self.send(200, dict(revision=result['revision'], receipt=receipt))
            except (ValueError, TypeError, UnicodeDecodeError) as error:
                self.send(400, dict(error=str(error)))
            except OSError:
                self.send(500, dict(error='No se pudo guardar. Tu borrador sigue disponible para descargar.'))
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.allowed_origins = origins
    server.prefix = prefix
    origins.update({f'http://127.0.0.1:{server.server_port}', f'http://localhost:{server.server_port}'})
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, help='JSON with id, title and questions')
    parser.add_argument('--home', type=Path, default=Path.home(), help='Storage home; use an isolated directory for QA')
    parser.add_argument('--build-only', action='store_true', help='Generate files without starting a server')
    parser.add_argument('--tunnel', action='store_true', help='Share this questionnaire through installed cloudflared')
    args = parser.parse_args()
    os.umask(0o077)
    if args.tunnel and args.build_only:
        parser.error('--tunnel and --build-only cannot be combined')
    if args.tunnel and not shutil.which('cloudflared'):
        parser.error('cloudflared is not installed; run without --tunnel for a local link')
    if args.input.stat().st_size > MAX_BODY:
        parser.error('Question JSON is too large')
    directory, config = prepare(json.loads(args.input.read_text()), args.home, args.input.resolve().parent)
    output = dict(id=config['sessionId'], htmlPath=str(directory / 'index.html'),
                  questionsPath=str(directory / 'questions.json'), responsesPath=str(directory / 'responses.json'))
    if args.build_only:
        print(json.dumps(dict(event='built', **output)), flush=True)
        return
    # One server owns this answer file; tab revisions alone cannot coordinate processes.
    instance = regular(directory / 'server.lock').open('a')
    try:
        fcntl.flock(instance, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise ValueError('This questionnaire already has a server. Reuse its runtime.json link.')
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    server = make_server(directory, config)
    origin = f'http://127.0.0.1:{server.server_port}'
    output.update(localUrl=origin + server.prefix, pid=os.getpid())
    write_json(directory / 'runtime.json', output)
    print(json.dumps(dict(event='ready', **output)), flush=True)
    tunnel = None
    if args.tunnel:
        tunnel = subprocess.Popen(['cloudflared', 'tunnel', '--no-autoupdate', '--url', origin, '--http-host-header', f'127.0.0.1:{server.server_port}'],
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        def tunnel_log():
            with regular(directory / 'tunnel.log').open('w') as log:
                for line in tunnel.stdout:
                    log.write(line)
                    log.flush()
                    match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
                    if match:
                        public_origin = match[0]
                        server.allowed_origins.add(public_origin)
                        output['publicUrl'] = public_origin + server.prefix
                        write_json(directory / 'runtime.json', output)
                        print(json.dumps(dict(event='shared', **output)), flush=True)
            print(json.dumps(dict(event='tunnel-closed', returncode=tunnel.wait(), localUrl=output['localUrl'])), flush=True)
        threading.Thread(target=tunnel_log, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if tunnel:
            tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
                tunnel.wait()
        instance.close()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(f'Questionnaire error: {error}', file=sys.stderr)
        sys.exit(1)
