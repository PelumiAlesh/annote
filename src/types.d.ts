declare module "css-tree" {
  export const lexer: {
    matchProperty: (property: string, value: string) => { matched: unknown; error?: Error };
  };
}
