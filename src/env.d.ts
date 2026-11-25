/** The islands' content in one language, built from the YAML files by scripts/content-module.ts. */
declare module 'virtual:content/*' {
  const content: import('./lib/content').ContentBundle;
  export default content;
}
