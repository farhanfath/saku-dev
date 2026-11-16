---
name: Saku
description: A clear local workspace for deliberate file operations.
colors:
  teal: "#087f70"
  teal-dark: "#066659"
  focus: "#168c7b"
  petrol: "#183f48"
  petrol-active: "#2e5961"
  rail-text: "#f1fafa"
  workspace: "#fff"
  canvas: "#f4f7f8"
  ink: "#253a40"
  muted: "#60737a"
  secondary-text: "#566d75"
  line: "#dce5e8"
  input-border: "#748b94"
  table-header: "#f7f9fa"
  row-hover: "#fafcfc"
  row-focus: "#edf8f4"
  changed-text: "#096b5d"
  status-changed: "#167362"
  error-text: "#a13843"
  error-bg: "#fceced"
  error-border: "#c26770"
  disabled-bg: "#e4ebed"
  disabled-text: "#687d84"
typography:
  headline:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "29px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.03em"
  title:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-.015em"
  body:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
  label:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  small:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "10px"
rounded:
  compact: "4px"
  field: "5px"
  control: "6px"
  navigation: "7px"
  workspace: "10px"
  dialog: "12px"
spacing:
  tight: "10px"
  compact: "12px"
  field: "14px"
  standard: "16px"
  section: "20px"
  roomy: "24px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.workspace}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "{colors.teal-dark}"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-bg}"
    textColor: "{colors.disabled-text}"
  button-secondary:
    backgroundColor: "{colors.workspace}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  name-field:
    backgroundColor: "{colors.workspace}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "9px 10px"
  navigation-active:
    backgroundColor: "{colors.petrol-active}"
    textColor: "{colors.rail-text}"
    rounded: "{rounded.navigation}"
    padding: "12px 14px"
  workspace:
    backgroundColor: "{colors.workspace}"
    rounded: "{rounded.workspace}"
  confirmation-dialog:
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "28px"
---

# Design System: Saku

## Overview

**Creative North Star: "The Clear Workbench"**

The Clear Workbench turns a local file operation into a calm editing task. A cool white workspace sits beside a deep petrol rail; teal identifies deliberate actions and keyboard focus. Compact controls and aligned columns keep original and proposed filenames easy to compare.

The system uses native-feeling Windows typography, restrained rounding, and flat surfaces. Operational state stays readable through words and icons alongside colour. This record describes the implemented UI; project scope, decisions, and release status remain in D:\vault\desktop-local-tool-vault.

**Key Characteristics:**

- Cool white workspace with a petrol navigation rail.
- Compact, aligned file rows and visibly bounded edit fields.
- Teal actions and focus; words and icons explain state.
- Indonesian copy and a Windows system UI font.

## Colors

The palette combines a cool neutral work area, a petrol structural rail, and a restrained teal action colour. Frontmatter values are extracted from `src/style.css`; the sidecar's tonal ramps are generated previews, not additional production tokens.

### Primary

- **Teal / Teal Dark:** primary buttons and their enabled hover state.
- **Focus:** visible keyboard outlines, edit-field focus borders, and the related subtle halo.
- **Changed Text / Status Changed:** proposed-name text and its labelled row status.

### Secondary

- **Petrol / Petrol Active / Rail Text:** navigation rail, current tool, and rail foreground.
- **Error Text / Error Background / Error Border:** invalid rows and their readable feedback. Notice colours also distinguish informational, success, and recovery messages; their exact treatments remain in the source and sidecar snippets.

### Neutral

- **Workspace / Canvas:** white editing surface on a cool off-white application background.
- **Ink / Muted / Secondary Text:** main names and controls, explanatory paragraphs, and small metadata/status text respectively.
- **Line / Input Border:** quiet structural separators versus a stronger, visible boundary around editable names.
- **Table Header / Row Hover / Row Focus:** restrained layers that preserve stable column alignment.
- **Disabled Background / Disabled Text:** the unavailable primary action.

**The Readable State Rule.** Use colour together with a word and an icon for row state; the current UI distinguishes unchanged, changed, and invalid rows this way.

## Typography

**UI Font:** Segoe UI, with system-ui and sans-serif fallbacks. There is no separate display or monospace face.

The type is compact and familiar to Windows users. Weight and spacing establish hierarchy; filenames remain plain and readable. No font assets are downloaded.

### Hierarchy

- **Headline:** page title; the frontmatter headline role. It becomes smaller (25px) at the narrow breakpoint.
- **Title:** empty-state heading; the frontmatter title role. Confirmation titles use a slightly larger title (19px, letter spacing -.02em).
- **Body:** filenames, fields, buttons, notices, and empty-state explanation use the compact body size. Paragraph line heights vary by context: header (1.6), empty state (1.85), and dialog (1.7).
- **Label:** toolbar headings and current navigation item; semibold.
- **Small:** table headings, metadata, row state, and footer help. Extension labels and text actions use an intermediate size (11px).
- **Numbers:** counts and row numbers use tabular numerals.

## Layout

The desktop shell is a two-column grid: a fixed navigation rail (208px) and a flexible workspace. Main content is centred with a maximum width (1800px), top inset (42px), and horizontal insets (38px). At wide viewports (min-width 1450px), horizontal insets increase (54px).

The editor is one flexing, bordered surface with a toolbar, file area, and lower status strip. Its minimum height is 430px; the file area has a minimum height of 320px. Toolbar padding is 16px 20px. The table uses fixed columns: row number (43px), original name (36%), status (89px), remove control (38px), with remaining width for the proposed name. Rows use 15px 10px cell padding. The action summary and Apply/Undo controls sit below the workspace.

At max-width 1050px, the rail narrows (170px), main insets reduce (32px 24px), shortcut decorations disappear, and footer actions wrap. At max-width 760px, the rail becomes a horizontal top bar, main insets reduce again (26px 18px), toolbars wrap, and footer buttons share the full width. The table keeps a minimum width (590px) and scrolls horizontally inside the file area. Body minimum width is 360px.

## Elevation & Depth

Depth comes primarily from white and tinted surfaces with fine borders. The workspace has no cast shadow. Secondary buttons use an inset stroke rather than elevation. The focused input uses a soft ring, and a modal confirmation uses the only cast shadow.

- **Secondary control stroke:** `inset 0 0 0 1px #cddadd`.
- **Input focus halo:** `0 0 0 2px #168c7b24`.
- **Confirmation shadow:** `0 20px 80px #17384035`, against a dimmed backdrop (`#13333d60`).

**The Quiet Depth Rule.** Keep the main workspace flat; reserve a cast shadow and backdrop for modal confirmation.

## Shapes

Small rounded rectangles define controls, fields, labels, and the workspace. The radius roles in frontmatter reflect repeated shapes; the count badge shares the field radius and keyboard hints use the compact radius. The empty-state icon is a larger soft square (66px with an 18px radius), with a small overlapping add badge. Borders and separators stay thin (1px); drag feedback uses a dashed border (2px).

## Components

### Buttons

Compact and explicit. Primary buttons use teal with white text; enabled hover uses Teal Dark. Secondary buttons use a white surface and inset stroke, shifting to a cool tint on hover (`#edf4f4`). Standard buttons have a minimum height (40px), and the smaller recovery action uses 32px.

Keyboard focus uses a visible outline (2px, offset 3px). Primary disabled styling uses the frontmatter tokens; secondary disabled styling uses cool grey text and a quieter inset stroke. Background and stroke transitions take .16s ease-out. Text actions are unfilled and underline on enabled hover.

### Inputs / Fields

The name field is visibly bounded by Input Border. Its focus border uses Focus, with the halo described above. The input itself has no duplicate outline because the wrapper owns the focus treatment. Protected extensions appear as a separate suffix in the same field boundary. Changed text is teal and slightly heavier (500); invalid fields use Error Border and an explanation below the field. The checkbox uses the teal accent colour.

### Navigation

A petrol rail carries one current-tool link on a lighter petrol rectangle. Its label is semibold and accompanied by a decorative icon. At the narrow breakpoint it becomes a compact horizontal header. The current implementation has no separate navigation hover colour; keyboard focus remains visible.

### Workspace / File Rows

A single white container groups toolbar, editable table, and lower status strip. Original names truncate with ellipsis while retaining their full title; metadata sits beneath. New names keep an editable field beside the original. Hover softly tints a row, and focus-within applies Row Focus. State text and icons distinguish unchanged, changed, and invalid entries.

### Notices / Confirmation

Notices pair a leading icon with wrapped text. Informational, success, error, and recovery states each have a tinted background and readable foreground. Recovery also carries an action. Confirmation uses a native dialog element with a compact title, explanatory text, and right-aligned secondary/primary actions.

Motion is limited to colour and stroke changes: rows use .15s ease-out, buttons .16s ease-out. The reduced-motion query disables transitions and animations.

## Do's and Don'ts

### Do:

- Do keep original and proposed names visible together.
- Do use the established teal focus treatment on editable fields.
- Do pair changed, invalid, and recovery states with readable text and an icon.
- Do preserve the table's horizontal scrolling at narrow widths.

### Don't:

- Don't use colour alone to communicate file state.
- Don't turn the flat workspace into a stack of raised cards.
- Don't hide original names when a new name is being edited.

