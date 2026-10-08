/**
 * Chat formatting subset rendered as React elements, never as HTML:
 * ```code blocks```, `code`, **bold**, *italic*, _italic_, __underline__,
 * ~~strike~~, ||spoiler||, links and @mentions of current participants.
 */
export type MarkdownNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'codeblock'; value: string; language: string | null }
  | { type: 'link'; url: string }
  | { type: 'mention'; name: string }
  | {
      type: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler';
      children: MarkdownNode[];
    };

type Wrapper = Extract<MarkdownNode, { children: MarkdownNode[] }>['type'];

interface Rule {
  pattern: RegExp;
  build: (match: RegExpExecArray, depth: number) => MarkdownNode;
}

const MAX_DEPTH = 4;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrap(type: Wrapper, group = 1) {
  return (match: RegExpExecArray, depth: number): MarkdownNode => ({
    type,
    children: parseInline(match[group] ?? '', depth + 1, []),
  });
}

function rules(names: string[]): Rule[] {
  const list: Rule[] = [
    {
      pattern: /`([^`\n]+)`/,
      build: (match) => ({ type: 'code', value: match[1] ?? '' }),
    },
    {
      pattern: /https?:\/\/[^\s<>"']*[^\s<>"'.,:;!?)\]]/,
      build: (match) => ({ type: 'link', url: match[0] }),
    },
    { pattern: /\*\*([\s\S]+?)\*\*/, build: wrap('bold') },
    { pattern: /__([\s\S]+?)__/, build: wrap('underline') },
    { pattern: /~~([\s\S]+?)~~/, build: wrap('strike') },
    { pattern: /\|\|([\s\S]+?)\|\|/, build: wrap('spoiler') },
    { pattern: /\*(?![\s*])([\s\S]*?[^\s*])\*/, build: wrap('italic') },
    {
      pattern:
        /(?<![\p{L}\p{N}_])_(?![\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])/u,
      build: wrap('italic'),
    },
  ];
  if (names.length) {
    // Longest names first so "Ana Clara" wins over "Ana".
    const alternatives = [...names]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|');
    list.push({
      pattern: new RegExp(
        `(?<![\\p{L}\\p{N}_])@(${alternatives})(?![\\p{L}\\p{N}_])`,
        'iu',
      ),
      build: (match) => ({ type: 'mention', name: match[1] ?? '' }),
    });
  }
  return list;
}

function parseInline(
  text: string,
  depth: number,
  names: string[],
): MarkdownNode[] {
  if (depth > MAX_DEPTH) return text ? [{ type: 'text', value: text }] : [];
  // Each rule keeps its next match from the cursor; a rule is re-run only
  // after the cursor passes its cached match, and a rule that found nothing
  // never runs again. This keeps adversarial messages near linear.
  const active = rules(names).map((rule) => ({
    rule,
    pattern: new RegExp(rule.pattern.source, `${rule.pattern.flags}g`),
    next: undefined as RegExpExecArray | null | undefined,
  }));
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let best: (typeof active)[number] | null = null;
    for (const entry of active) {
      if (entry.next === null) continue;
      if (entry.next === undefined || entry.next.index < cursor) {
        entry.pattern.lastIndex = cursor;
        entry.next = entry.pattern.exec(text);
        if (entry.next === null) continue;
      }
      if (!best?.next || entry.next.index < best.next.index) best = entry;
    }
    const match = best?.next;
    if (!best || !match) {
      nodes.push({ type: 'text', value: text.slice(cursor) });
      break;
    }
    if (match.index > cursor)
      nodes.push({ type: 'text', value: text.slice(cursor, match.index) });
    nodes.push(best.rule.build(match, depth));
    cursor = match.index + match[0].length;
  }
  return mergeText(nodes);
}

function mergeText(nodes: MarkdownNode[]): MarkdownNode[] {
  const merged: MarkdownNode[] = [];
  for (const node of nodes) {
    const last = merged[merged.length - 1];
    if (node.type === 'text' && last?.type === 'text')
      merged[merged.length - 1] = {
        type: 'text',
        value: last.value + node.value,
      };
    else merged.push(node);
  }
  return merged;
}

/** `names` are display names that can be mentioned (current participants). */
export function parseMarkdown(
  text: string,
  names: string[] = [],
): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const fence = /```(?:([A-Za-z0-9_+-]{1,20})\n)?([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    const index = match.index ?? 0;
    if (index > cursor)
      nodes.push(...parseInline(text.slice(cursor, index), 0, names));
    nodes.push({
      type: 'codeblock',
      language: match[1] ?? null,
      value: (match[2] ?? '').replace(/^\n/, '').replace(/\n$/, ''),
    });
    cursor = index + match[0].length;
  }
  if (cursor < text.length)
    nodes.push(...parseInline(text.slice(cursor), 0, names));
  return mergeText(nodes);
}
