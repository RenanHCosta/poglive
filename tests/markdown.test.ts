import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../src/renderer/services/markdown';
import { mentions } from '../src/renderer/services/ChatController';

test('inline formatting nests and keeps plain text intact', () => {
  assert.deepEqual(parseMarkdown('oi **forte _e itálico_** fim'), [
    { type: 'text', value: 'oi ' },
    {
      type: 'bold',
      children: [
        { type: 'text', value: 'forte ' },
        { type: 'italic', children: [{ type: 'text', value: 'e itálico' }] },
      ],
    },
    { type: 'text', value: ' fim' },
  ]);
  assert.deepEqual(parseMarkdown('sem formatação'), [
    { type: 'text', value: 'sem formatação' },
  ]);
});

test('code is literal and never parsed further', () => {
  assert.deepEqual(parseMarkdown('use `**não**` aqui'), [
    { type: 'text', value: 'use ' },
    { type: 'code', value: '**não**' },
    { type: 'text', value: ' aqui' },
  ]);
  assert.deepEqual(parseMarkdown('```ts\nconst a = 1;\n```'), [
    { type: 'codeblock', language: 'ts', value: 'const a = 1;' },
  ]);
});

test('links stop before trailing punctuation and snake_case stays plain', () => {
  assert.deepEqual(parseMarkdown('veja https://example.com/a_b_c.'), [
    { type: 'text', value: 'veja ' },
    { type: 'link', url: 'https://example.com/a_b_c' },
    { type: 'text', value: '.' },
  ]);
  assert.deepEqual(parseMarkdown('nome_de_arquivo'), [
    { type: 'text', value: 'nome_de_arquivo' },
  ]);
  // Only http(s) is linkified.
  assert.deepEqual(parseMarkdown('javascript:alert(1)'), [
    { type: 'text', value: 'javascript:alert(1)' },
  ]);
});

test('mentions match current participants only, longest name first', () => {
  assert.deepEqual(parseMarkdown('@Ana Clara e @Bob', ['Ana', 'Ana Clara']), [
    { type: 'mention', name: 'Ana Clara' },
    { type: 'text', value: ' e @Bob' },
  ]);
  assert.equal(mentions('fala @renan!', 'Renan'), true);
  assert.equal(mentions('email@renan.com', 'renan'), false);
});

test('spoilers, strike and unmatched markers', () => {
  assert.deepEqual(parseMarkdown('||segredo|| ~~velho~~ *solto'), [
    { type: 'spoiler', children: [{ type: 'text', value: 'segredo' }] },
    { type: 'text', value: ' ' },
    { type: 'strike', children: [{ type: 'text', value: 'velho' }] },
    { type: 'text', value: ' *solto' },
  ]);
});
