/**
 * studioTheme.ts
 * Custom CodeMirror 6 theme & syntax highlighting built from the sampled design palette.
 * All colors reference CSS variables on :root; all syntax tokens meet WCAG AA contrast on --canvas.
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Extension } from "@codemirror/state";

const mintuEditorUiTheme = EditorView.theme(
  {
    "&": {
      color: "var(--text)",
      backgroundColor: "var(--canvas)",
      height: "100%",
      fontSize: "13px",
      fontFamily: "var(--font-mono)",
    },
    ".cm-scroller": {
      overflow: "auto",
      lineHeight: "1.65",
      fontFamily: "var(--font-mono)",
    },
    ".cm-content": {
      caretColor: "var(--text)",
      padding: "10px 0 48px 0",
    },
    ".cm-line": {
      padding: "0 16px 0 10px",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--text)",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "var(--selection)",
      },
    ".cm-activeLine": {
      backgroundColor: "var(--editor-active-line)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--canvas)",
      color: "var(--text-subtle)",
      border: "none",
      paddingLeft: "8px",
      paddingRight: "10px",
      userSelect: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "28px",
      padding: "0 8px 0 4px",
      fontSize: "12px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--editor-active-line)",
      color: "var(--text-muted)",
    },
    ".cm-foldGutter .cm-gutterElement": {
      color: "var(--text-subtle)",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "var(--selection)",
      outline: "1px solid var(--border-strong)",
    },
  },
  { dark: true }
);

const mintuSyntaxStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.moduleKeyword], color: "var(--syn-keyword)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName)], color: "var(--syn-function)" },
  { tag: [tags.tagName], color: "var(--syn-tag)" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.macroName], color: "var(--syn-type)" },
  { tag: [tags.attributeName, tags.propertyName], color: "var(--syn-attr)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syn-string)" },
  { tag: [tags.number, tags.bool, tags.atom, tags.null, tags.self], color: "var(--syn-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.angleBracket], color: "var(--syn-punct)" },
  { tag: [tags.variableName, tags.content], color: "var(--syn-plain)" },
  { tag: [tags.invalid], color: "var(--danger)" },
]);

export const mintuStudioTheme: Extension = [
  mintuEditorUiTheme,
  syntaxHighlighting(mintuSyntaxStyle),
];
