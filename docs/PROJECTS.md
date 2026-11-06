# Local DetWeave projects

The browser workbench saves named projects in `~/Documents/DetWeave/projects` by default. Set `DETWEAVE_PROJECTS_DIR` before starting a standalone server to choose a different root. The desktop launcher supplies its app data directory. Projects remain available when the workbench restarts.

A project folder starts with a filesystem-safe version of its original title and ends with a unique identifier. Changing the displayed title updates the project metadata. Its folder path stays stable.

- `project.json` holds the title and current working draft.
- `prompts/<id>.json` records each distinct saved or submitted prompt revision. Submitting an unchanged prompt again links another run to that revision.
- `runs/<id>/run.json` records a submission before its provider call. `system-prompt.txt` contains the full system prompt for remote models. A completed run has an `outcome` directory with its status and, on success, separate IR, validation and public provenance JSON files.
- `exports/<id>/` contains a copy of a validated geometry ZIP and its SHA-256 digest.

The project records failed and cancelled submissions and preserves the last accepted model. A server restart during an unfinished run shows it as interrupted. Provider credentials, live reasoning and partial model output are kept out of the project folder. Draft text and geometry may contain sensitive material entered by the user. Back up or move an entire project folder to preserve its history. Use one workbench server per project library.

## Local API

All project mutations use JSON and the existing `X-DetWeave: 1` request header.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/projects` | Project summaries in `projects` |
| POST | `/api/projects` | Create a project with `title` and an optional `draft` |
| GET | `/api/projects/<id>` | Open the draft, prompt revisions, run summaries and export records |
| POST | `/api/projects/<id>` | Save `title`, `draft`, or both |
| GET | `/api/projects/<id>/runs/<run-id>` | Read a run and its result, when available |

A draft includes `text`, `model`, `provenance`, `review_pending` and optional `json_text` for unapplied editor text. `/api/extract`, `/api/extract/stream` and `/api/export` accept a top-level `project_id` to persist the operation. The server returns a storage error if it cannot save the operation. A connected browser receives storage errors before a result is accepted.
