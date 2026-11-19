// Electron's <webview> element, used to show the Fenna editors inside a bot's computer.
import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<WebviewElement>, WebviewElement> & { src?: string };
    }
  }
}

declare global {
  interface WebviewElement extends HTMLElement {
    getWebContentsId(): number;
    loadURL(url: string): Promise<void>;
  }
}
