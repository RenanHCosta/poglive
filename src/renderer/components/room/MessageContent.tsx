import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { parseMarkdown } from '../../services/markdown';
import type { MarkdownNode } from '../../services/markdown';
import { pushToast } from '../../services/toasts';

function openLink(url: string): void {
  void window.pogLive
    .openExternal(url)
    .then((result) => {
      if (result.status === 'ERROR') pushToast(result.message, 'error');
    })
    .catch(() => pushToast('Não foi possível abrir o link.', 'error'));
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`md-spoiler${revealed ? ' revealed' : ''}`}
      role={revealed ? undefined : 'button'}
      tabIndex={revealed ? undefined : 0}
      aria-label={revealed ? undefined : 'Spoiler, clique para revelar'}
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') setRevealed(true);
      }}
    >
      {children}
    </span>
  );
}

function render(
  nodes: MarkdownNode[],
  selfName: string,
  prefix = '',
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}${index}`;
    switch (node.type) {
      case 'text':
        return node.value;
      case 'code':
        return (
          <code key={key} className="md-code">
            {node.value}
          </code>
        );
      case 'codeblock':
        return (
          <pre key={key} className="md-codeblock">
            <code>{node.value}</code>
          </pre>
        );
      case 'link':
        return (
          <a
            key={key}
            href={node.url}
            className="md-link"
            title={node.url}
            onClick={(event) => {
              event.preventDefault();
              openLink(node.url);
            }}
          >
            {node.url}
          </a>
        );
      case 'mention':
        return (
          <span
            key={key}
            className={`md-mention${node.name.toLocaleLowerCase() === selfName.toLocaleLowerCase() ? ' self' : ''}`}
          >
            @{node.name}
          </span>
        );
      case 'bold':
        return (
          <strong key={key}>
            {render(node.children, selfName, `${key}.`)}
          </strong>
        );
      case 'italic':
        return <em key={key}>{render(node.children, selfName, `${key}.`)}</em>;
      case 'underline':
        return <u key={key}>{render(node.children, selfName, `${key}.`)}</u>;
      case 'strike':
        return <s key={key}>{render(node.children, selfName, `${key}.`)}</s>;
      case 'spoiler':
        return (
          <Spoiler key={key}>
            {render(node.children, selfName, `${key}.`)}
          </Spoiler>
        );
    }
  });
}

export function MessageContent({
  text,
  names,
  selfName,
}: {
  text: string;
  names: string[];
  selfName: string;
}) {
  const nodes = useMemo(() => parseMarkdown(text, names), [text, names]);
  return <div className="message-text">{render(nodes, selfName)}</div>;
}
