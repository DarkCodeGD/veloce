import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { loadFonts } from "./fonts.js";
import { blockPageZoom } from "./page-zoom.js";
import "./styles.css";

void loadFonts();
blockPageZoom(); // Ctrl + scroll / pinch / Ctrl + "+" never zoom the whole UI (page-zoom.ts)
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
