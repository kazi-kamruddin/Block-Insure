# Repository contents

The public repository contains application source, tests, package lockfiles,
deployment templates, public setup instructions, and the artifacts required by
the runtime, dashboards, and integrity checks.

## Versioned dependencies

Keep the packaged models, model policy, dataset manifests, required test
fixtures, contract ABIs, and current evaluation/dashboard artifacts. Some modules
inside `backEnd/research/` are runtime dependencies; that directory is not an
optional collection of notes.

## Local files

Git ignores private environment files and keys, installed dependencies, build
outputs, caches, generated browser reports, local execution evidence, working
references, operator handoffs, and superseded evaluation exports.

These files can remain at their existing local paths. Ignoring them does not
prevent the application or development tools from reading or regenerating them.
They are not supplied by a fresh clone and need a separate private backup if
they must be retained.

Public setup is documented in [local development](local-development.md).
Verification commands generate local results as needed. Source snapshots can be
created with `node scripts/prepareReleaseCandidate.js`; optional evidence is
selected explicitly with `--evidence verification-results/<name>.json`.
Snapshot output is local and refuses to overwrite an existing record.

Historical research records retain their original hashes. The repository check
validates those records and compares current runtime, model, dataset and study
inputs. The [reviewed source transition](research-source-transition-v4.json) binds
the exact accepted differences from the historical manifest; any additional
unreviewed difference fails verification. This preserves provenance and does not
revalidate old measurements for the new runtime. Changes to source-snapshot and
repository-check bookkeeping tools are reported separately.

## Git tracking

Ignore rules apply to untracked files. Removing a previously tracked path from
the index with `git rm --cached` preserves its local copy. A later commit records
the removal from the current tree; existing commits remain unchanged.
