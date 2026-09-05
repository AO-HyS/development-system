# ADR 0022: Portable visual documents at closure and on request

Status: Accepted by operator instruction, 2026-09-04.

The operator rejected the delivered 1.7 report: a runtime Mermaid canvas was
empty in the screenshot and clipped when inspected directly. The approved
reference used a PR Lens SVG map and static HTML/CSS bars. Testing a fixture
instead of the delivered document missed the failure.

Version 1.8 adds a shared report presentation based on that reference. PR Lens
provides geometry; the presentation supplies readable labels and minimal
controls. SVGs are embedded as images, essential content is present without
JavaScript, and maps can be expanded and scrolled. Bars retain explicit values.
The canonical workflow Reader keeps its existing lifecycle presentation.

`development-system document` accepts completion, review and explanation
packets and writes private Markdown, HTML and a complete JSON source packet.
Content and rendered bytes identify immutable snapshots. Unsafe paths/images,
missing visuals and conflicting files fail rather than producing false success.
Generation supplies hashes, never a verification or authorization claim.

Implement Preview uses this generator for its recap and validates the resulting
files and hashes before recording that lifecycle step. Failure preserves the
evidence of external actions already performed. The conversational implementation
and review skills explicitly call the command before their final answer.
The router recognizes on-demand review/spec explanations without initiating
implementation. There is no universal native turn-close daemon.

Acceptance covers the actual full report in the authorized Computer Use surface,
desktop and mobile, maps, bars, navigation, theme and source. Published artifacts
through 1.7 remain immutable. This tooling release does not require deploying
consumer applications.
