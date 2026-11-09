# Contributing

Use Python 3.10+, install `python -m pip install -e '.[dev]'`, and run `python -m pytest -q`.
Keep shape semantics, material mappings, provenance and native validation boundaries explicit.
New geometry features require schema validation, deterministic output, boundary/negative cases,
and comparisons against the actual target backend. Do not mark runtime checks passed from static tests.

Only synthetic examples belong in this public repository. Never commit API credentials, real meeting
records, private detector descriptions, local environments, or user-generated project bundles.
`local/` is ignored for build logs and native validation outputs. Changes to extraction prompts
must update the prompt version and include representative fixtures.

The framework does not execute arbitrary source from model responses. Backend code is produced
from reviewed templates. Do not add automatic shell execution of returned model text.

This release uses the DetWeave Noncommercial Attribution and Citation License.
By submitting a contribution, identify its original authorship and any third-party licenses,
and provide it on terms compatible with the current project license. Do not remove author notices.

## Developer UI and next release

Use the **developer web environment** instructions in [English](README.md) or
[中文](README.zh-CN.md). No native build is needed for Python/HTML/JS development.
For the current review-first release process and files to inspect, read
[v0.3.0 preparation](docs/releases/v0.3.0-preparation.md). Do not dispatch native
builds, create the version tag or publish until independent review is addressed.
