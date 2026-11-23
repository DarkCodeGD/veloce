import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { trackPointer } from "./add-menu.js";
import { installCommandKeys, registerBuiltinCommands } from "./editor-commands.js";
import { loadFonts } from "./fonts.js";
import { blockPageZoom } from "./page-zoom.js";
import "./styles.css";

void loadFonts();
registerBuiltinCommands(); // every command: menus, tools, the Add menu (D81, D89)
installCommandKeys(); // every shortcut runs a registry command (D89)
trackPointer(); // Shift+A opens the Add menu at the pointer
blockPageZoom(); // Ctrl + scroll / pinch / Ctrl + "+" never zoom the whole UI (page-zoom.ts)
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
