// Images imported by the shell's components resolve to their URLs (Vite).
declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.svg" {
  const url: string;
  export default url;
}
