# Summarizes one Claude Code session under the roster: tokens and estimated cost per
# agent (from the transcripts), guard decisions and Jev routing (from the ledger).
#   python3 run-report.py <session-id> [project-dir-name]
# Without a session id it uses the newest session in the ledger. Costs are estimates
# from list prices, not billing evidence.
import glob, json, os, sys, collections

LEDGER = os.path.expanduser('~/.development-system/private/runs/claude-orchestration/ledger.jsonl')
PROJECTS = os.path.expanduser('~/.claude/projects')
# USD per million tokens: input, output, cache read, cache write (5 min).
PRICES = {'opus': (4, 20, 0.20, 5), 'fable': (10, 50, 0.25, 12.5), 'haiku': (1, 5, 0.10, 1.25), 'sonnet': (2, 10, 0.20, 2.5)}

rows = [json.loads(l) for l in open(LEDGER)]
session = sys.argv[1] if len(sys.argv) > 1 else rows[-1]['session']
events = [r for r in rows if r.get('session') == session]

def family(model):
    return next((k for k in PRICES if k in str(model)), 'opus')

def usage(file):
    seen, tot, model, images, turns = set(), collections.Counter(), None, 0, 0
    for line in open(file):
        try: d = json.loads(line)
        except ValueError: continue
        m = d.get('message') or {}
        if isinstance(m.get('content'), list):
            images += sum(1 for c in m['content'] if isinstance(c, dict) and c.get('type') == 'tool_result'
                          and any(isinstance(x, dict) and x.get('type') == 'image' for x in (c.get('content') or []) if isinstance(c.get('content'), list)))
        if d.get('type') != 'assistant' or not m.get('usage') or m.get('id') in seen: continue
        seen.add(m.get('id')); turns += 1
        model = m.get('model') or model
        u = m['usage']
        tot['in'] += u.get('input_tokens', 0); tot['out'] += u.get('output_tokens', 0)
        tot['cr'] += u.get('cache_read_input_tokens', 0); tot['cw'] += u.get('cache_creation_input_tokens', 0)
    p = PRICES[family(model)]
    cost = (tot['in'] * p[0] + tot['out'] * p[1] + tot['cr'] * p[2] + tot['cw'] * p[3]) / 1e6
    return model, turns, tot, images, cost

main = glob.glob(os.path.join(PROJECTS, sys.argv[2] if len(sys.argv) > 2 else '*', f'{session}.jsonl'))
subs = glob.glob(os.path.join(PROJECTS, '*', session, 'subagents', 'agent-*.jsonl'))
types = {r.get('agentId'): r.get('type') for r in events if r.get('event') == 'agent-result' and r.get('agentId')}

print(f'Session {session}')
print(f"{'agent':34} {'model':26} {'turns':>5} {'input':>8} {'cache rd':>10} {'cache wr':>9} {'output':>8} {'img':>4} {'est $':>7}")
total = 0
by_role = collections.Counter()
for label, file in [('coordinator', f) for f in main] + [(types.get(os.path.basename(f)[6:-6], '?') + ' ' + os.path.basename(f)[6:14], f) for f in sorted(subs)]:
    model, turns, t, images, cost = usage(file)
    total += cost
    by_role[label.split(' ')[0]] += cost
    print(f"{label:34} {str(model):26} {turns:5} {t['in']:8} {t['cr']:10} {t['cw']:9} {t['out']:8} {images:4} {cost:7.2f}")
print(f'Estimated total ${total:.2f}; by role: ' + ', '.join(f'{k} ${v:.2f}' for k, v in by_role.most_common()))

print('\nGuard')
kinds = collections.Counter()
for r in events:
    if r.get('event') == 'agent-result': continue
    k = r.get('decision')
    k = 'allow' if str(k).startswith('/') else k  # early ledger rows stored the Jev decision path here
    if k == 'deny':
        reason = r.get('reason', '')
        k = 'deny: ' + ('one writer per surface' if 'One writer' in reason else 'open decision' if r.get('blockedBy') else 'jev mismatch' if 'Jev' in reason
                        else 'image budget' if 'Image budget' in reason else 'packet markers' if 'Writer packets' in reason else 'roster/model')
    kinds[f"{k} {r.get('tool', '')} {r.get('type') or r.get('owner') or ''}".strip()] += 1
for k, n in kinds.most_common(): print(f'{n:4}  {k}')

print('\nJev')
for r in events:
    if r.get('jev'):
        s = r.get('signals') or {}
        print(f"  {'allow' if str(r.get('decision')).startswith('/') else r.get('decision'):5} {r['type']:18} proposed={r.get('proposed')} conf={r.get('confidence')} open={s.get('openDecision')} ctx={s.get('contextSufficient')} | {r.get('rationale') or r.get('why') or ''}"[:200])
print('\nTier (role tier vs the tier Jev picked)')
for r in events:
    t = r.get('tier')
    if t:
        print(f"  {r.get('decision'):5} {r['type']:20} used={t.get('used')} jev={t.get('jevTier')} conf={t.get('confidence')} -> {', '.join(t.get('target') or []) or t.get('why') or ''}"[:200])
MEMORY = os.path.join(os.path.dirname(LEDGER), 'tier-memory.jsonl')
if os.path.exists(MEMORY):
    mem = [json.loads(l) for l in open(MEMORY) if l.strip()]
    agree = sum(1 for m in mem if m.get('tier') == m.get('jevTier'))
    print(f'Tier memory: {len(mem)} dispatches, {agree} at the tier Jev picked')
print('\nModels observed per dispatch: ' + ', '.join(f"{r.get('type')}={r.get('resolvedModel')}" for r in events if r.get('event') == 'agent-result'))
