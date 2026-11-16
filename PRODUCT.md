# Product

<!-- impeccable:product-schema 1 -->

Implementation context for the first desktop surface. Canonical project status, scope, and progress live in `D:\vault\desktop-local-tool-vault`; start at `Home.md` there.

## Platform

web

The UI runs inside a Tauri Windows desktop application, not a hosted website.

## Stack

User approved the recommendation: Rust + Tauri with a lightweight web UI. Vanilla JavaScript and CSS keep this single-screen tool small.

## Users

One personal desktop user who frequently renames files individually using the VS Code Batch Rename extension.

## Product Purpose

Rename several files in one reviewable session without opening VS Code. Individual name editing and keyboard movement are the core job.

## Capabilities and Constraints

Batch Rename: choose or drop regular files, edit names individually, show original and proposed names, protect extensions, validate conflicts, explicitly apply a batch, and undo the last applied batch. State and partial failures stay visible.

Second tool approved for implementation: local Markdown reader/editor/visualizer. The user selected rendered preview plus diagrams, and accepted the recommended Baca/Edit/Split workflow, outline, search, explicit safe saving, and desktop file opening. Retain the established visual identity. One document at a time is the initial scope; draft changes survive switching tools. Opening another document or closing the app must protect unsaved changes. Markdown files remain interoperable source text; no graph of note relationships or rich-text editor is required.

## Brand Commitments

User delegated the initial UI recommendation and has no file-type or visual preference yet. Use Indonesian product copy. User approved the product name Saku on 2026-11-11; repository/vault folder names and application identifier stay unchanged to preserve existing data.

## Product Principles

- Keyboard editing is a primary interaction.
- Draft changes are separate from filesystem actions.
- Do not overwrite data; explain conflicts with a recovery action.
- Keep operational details local and show truthful state.
