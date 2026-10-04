declare module 'markdown-it/lib/rules_block/reference.mjs' {
  import type { RuleBlock } from 'markdown-it/lib/parser_block.mjs';
  const reference: RuleBlock;
  export default reference;
}
declare module 'markdown-it/lib/rules_inline/link.mjs' {
  import type { RuleInline } from 'markdown-it/lib/parser_inline.mjs';
  const link: RuleInline;
  export default link;
}
