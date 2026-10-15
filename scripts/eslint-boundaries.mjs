/** Complement no-restricted-imports, which checks static imports/re-exports only. */
export const dynamicUiBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      ui: 'Runtime modules must not dynamically import workspace UI.',
    },
  },
  create(context) {
    return {
      ImportExpression(node) {
        const source =
          node.source.type === 'TemplateLiteral' &&
          node.source.expressions.length === 0
            ? node.source.quasis[0].value.cooked
            : node.source.value;
        if (
          typeof source === 'string' &&
          /(^|\/)(workspace|components)(\/|$)/.test(source)
        )
          context.report({ node, messageId: 'ui' });
      },
    };
  },
};
