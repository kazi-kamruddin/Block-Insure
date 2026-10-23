# Repository artifact storage

Source code, tests, deployment templates, documentation, dataset manifests,
model artifacts and small dated verification summaries belong in Git.

The following are local, ignored working directories:

- `tmp/`: scratch scripts, PDF page renders, previews and temporary test stacks.
- `output/`: generated paper PDFs, submission archives and exports.
- `playwright-report/`, `playwright-report-frontend/`, `playwright-reports/`,
  `test-results/`: generated browser reports, traces, screenshots and recordings.
- `reference/`, `.project-context/`, `paper-evidence/`: local references and context.
- Dependency, compiler, coverage and cache directories covered by `.gitignore`.

Under `verification-results/`, small JSON and text records remain tracked;
generated image, video and ZIP files are ignored. Keep dated provenance and
revision boundaries when recording new results. Historical results do not verify
newer source.

Tests can continue writing to ignored report directories. Their source and
configuration remain tracked. Reports will be created on demand in a fresh clone;
no application code needs a pre-existing report, paper PDF or scratch render.

The reusable contact-sheet utility is `scripts/make_contact_sheet.py` and requires
Pillow. For example:

```powershell
python scripts/make_contact_sheet.py tmp/pdfs/rendered-supervisor --output-dir tmp/pdfs
```

The old supervisor-document builder and artifact-tool spreadsheet helper in
`tmp/` are machine-specific research scratch scripts; local copies are preserved.
They are not application startup or test prerequisites.

Ignoring a path does not untrack previously committed files. This cleanup removes
generated/local artifacts from the Git index while preserving their local files.
After committing and pushing, they disappear from the branch's current tree;
earlier commits still contain them. No history rewrite is required for housekeeping.

Local-only papers and references require a separate backup if they must survive
loss of this workstation; a fresh clone will not restore them.
