import { css } from '@emotion/css';
import React, { useRef } from 'react';
import { useLatest } from 'react-use';

import { GrafanaTheme2 } from '@grafana/data';
import { selectors } from '@grafana/e2e-selectors';
import { monacoTypes, ReactMonacoEditor, useTheme2 } from '@grafana/ui';

import { LOGSQL_LANGUAGE_ID } from '../../lang/logsql/monarch';
import { registerLogsqlLanguage, registerFetchersFor } from '../../lang/logsql/monaco';
import { Props } from './MonacoQueryFieldProps';

const options: monacoTypes.editor.IStandaloneEditorConstructionOptions = {
  codeLens: false,
  contextmenu: false,
  fixedOverflowWidgets: true,
  folding: false,
  fontSize: 14,
  lineDecorationsWidth: 8,
  lineNumbers: 'off',
  minimap: { enabled: false },
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  padding: { top: 4, bottom: 5 },
  renderLineHighlight: 'none',
  scrollbar: {
    vertical: 'hidden',
    verticalScrollbarSize: 8,
    horizontal: 'hidden',
    horizontalScrollbarSize: 0,
  },
  scrollBeyondLastLine: false,
  suggestFontSize: 12,
  wordWrap: 'on',
};

const EDITOR_HEIGHT_OFFSET = 2;

const getStyles = (theme: GrafanaTheme2, placeholder: string) => ({
  container: css`
    border-radius: ${theme.shape.borderRadius()};
    border: 1px solid ${theme.components.input.borderColor};
  `,
  placeholder: css`
    ::after {
      content: '${placeholder}';
      font-family: ${theme.typography.fontFamilyMonospace};
      opacity: 0.3;
    }
  `,
});

const MonacoQueryField = (props: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { onBlur, onRunQuery, initialValue, placeholder, readOnly, fetchers } = props;

  const onRunQueryRef = useLatest(onRunQuery);
  const onBlurRef = useLatest(onBlur);
  const fetchersRef = useLatest(fetchers);

  const theme = useTheme2();
  const styles = getStyles(theme, placeholder);

  return (
    <div
      aria-label={selectors.components.QueryField.container}
      className={styles.container}
      ref={containerRef}
    >
      <ReactMonacoEditor
        options={{ ...options, readOnly }}
        language={LOGSQL_LANGUAGE_ID}
        value={initialValue}
        beforeMount={(monaco) => registerLogsqlLanguage(monaco)}
        onMount={(editor, monaco) => {
          const model = editor.getModel();
          if (model) {
            // Several LogsQL fields can be open at once, each against its own
            // datasource and range, so the providers find theirs by model.
            const forget = registerFetchersFor(model, fetchersRef.current);
            editor.onDidDispose(forget);
          }

          editor.onDidBlurEditorWidget(() => {
            onBlurRef.current(editor.getValue());
          });

          const updateElementHeight = () => {
            const containerDiv = containerRef.current;
            if (containerDiv !== null) {
              const pixelHeight = editor.getContentHeight();
              containerDiv.style.height = `${pixelHeight + EDITOR_HEIGHT_OFFSET}px`;
              containerDiv.style.width = '100%';
              const pixelWidth = containerDiv.clientWidth;
              editor.layout({ width: pixelWidth, height: pixelHeight });
            }
          };

          editor.onDidContentSizeChange(updateElementHeight);
          updateElementHeight();

          editor.addAction({
            id: 'execute-shift-enter',
            label: 'Execute',
            keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Enter],
            run: () => onRunQueryRef.current(editor.getValue() || ''),
          });

          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
            global.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
          });

          if (placeholder) {
            const placeholderDecorators = [
              {
                range: new monaco.Range(1, 1, 1, 1),
                options: {
                  className: styles.placeholder,
                  isWholeLine: true,
                },
              },
            ];

            let decorators: string[] = [];

            const checkDecorators = () => {
              const model = editor.getModel();
              if (!model) {
                return;
              }
              const newDecorators = model.getValueLength() === 0 ? placeholderDecorators : [];
              decorators = model.deltaDecorations(decorators, newDecorators);
            };

            checkDecorators();
            editor.onDidChangeModelContent(checkDecorators);
          }
        }}
      />
    </div>
  );
};

export default MonacoQueryField;
