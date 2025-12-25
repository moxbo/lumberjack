// === BROWSER CONSOLE DEBUG SCRIPT ===
// Kopiere diesen gesamten Text in die Browser-Konsole (F12) und drücke Enter
// um die interaktive Liste schnell zu überprüfen

console.log("🔍 Lumberjack Interactive List - Debug Script\n");

// ============= CSS Pointer Events Check =============
console.log("\n📋 CSS Pointer Events Check:");
const checks = [
  { selector: ".layout", expected: "auto", name: "Layout Container" },
  { selector: ".list", expected: "auto", name: "List Container" },
  { selector: ".row", expected: "auto", name: "Log Row" },
  { selector: ".overlay", expected: "none", name: "Overlay Container" },
  { selector: ".details", expected: "auto", name: "Details Panel" },
  { selector: ".divider", expected: "auto", name: "Divider" },
];

let pointerEventsOk = true;
checks.forEach(({ selector, expected, name }) => {
  const el = document.querySelector(selector);
  if (!el) {
    console.log(`  ❌ ${name} (${selector}) - NOT FOUND`);
    pointerEventsOk = false;
    return;
  }
  const actual = getComputedStyle(el).pointerEvents;
  const ok = actual === expected;
  const icon = ok ? "✅" : "❌";
  console.log(
    `  ${icon} ${name} (${selector}): ${actual} ${ok ? "" : `(expected: ${expected})`}`,
  );
  if (!ok) pointerEventsOk = false;
});

// ============= Focus Check =============
console.log("\n🎯 Focus Check:");
const list = document.querySelector(".list");
const isFocused = document.activeElement === list;
console.log(`  ${isFocused ? "✅" : "❌"} List is focused: ${isFocused}`);
console.log(`  Tab Index: ${list?.getAttribute("tabindex")}`);
console.log(`  Active Element: ${document.activeElement?.className}`);

// ============= Event Listeners Check =============
console.log("\n📻 Event Listeners Check:");
if (typeof getEventListeners === "function") {
  const listeners = getEventListeners(list);
  if (listeners) {
    const hasKeydown = listeners.keydown?.length > 0;
    const hasMousedown = listeners.mousedown?.length > 0;
    const hasClick = listeners.click?.length > 0;
    console.log(
      `  ${hasKeydown ? "✅" : "⚠️"} keydown listeners: ${listeners.keydown?.length || 0}`,
    );
    console.log(
      `  ${hasMousedown ? "✅" : "⚠️"} mousedown listeners: ${listeners.mousedown?.length || 0}`,
    );
    console.log(`  Click handlers are on individual rows (delegated)`);
  }
} else {
  console.log(`  ℹ️ getEventListeners only works in Chrome/Edge DevTools`);
}

// ============= Virtual Scroll Check =============
console.log("\n⚡ Virtual Scroll Check:");
const virtualContainer = document.querySelector(
  ".list > div:nth-child(2) > div",
);
if (virtualContainer) {
  const height = virtualContainer.style.height;
  const pointerEvents = getComputedStyle(virtualContainer).pointerEvents;
  console.log(`  ✅ Virtual container found`);
  console.log(`    Height: ${height}`);
  console.log(`    Pointer Events: ${pointerEvents}`);
} else {
  console.log(`  ⚠️ Virtual container not found`);
}

// ============= Rows Check =============
console.log("\n📝 Rows Check:");
const rows = document.querySelectorAll(".row");
console.log(`  Total rows rendered: ${rows.length}`);
if (rows.length > 0) {
  const firstRow = rows[0];
  const hasPointerEvents = getComputedStyle(firstRow).pointerEvents === "auto";
  const hasCursor = getComputedStyle(firstRow).cursor === "pointer";
  console.log(
    `  ${hasPointerEvents ? "✅" : "❌"} First row has pointer-events: auto`,
  );
  console.log(`  ${hasCursor ? "✅" : "❌"} First row has cursor: pointer`);

  // Check for .sel class
  const selectedRows = document.querySelectorAll(".row.sel");
  console.log(`  Selected rows (with .sel class): ${selectedRows.length}`);
}

// ============= Modals Check =============
console.log("\n🪟 Modals Check:");
const modals = document.querySelectorAll(".modal-backdrop");
console.log(`  Modal backdrops open: ${modals.length}`);
modals.forEach((modal, idx) => {
  const visible = modal.offsetParent !== null;
  console.log(`    Modal ${idx + 1}: ${visible ? "visible" : "hidden"}`);
});

// ============= Interactive Test =============
console.log("\n🧪 Interactive Test:");
console.log("  Attempting to click first row...");
const firstRow = document.querySelector(".row");
if (firstRow) {
  const hasSelBefore = firstRow.classList.contains("sel");
  console.log(`    Before click - has .sel: ${hasSelBefore}`);

  // Simulate click
  const clickEvent = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window,
  });
  firstRow.dispatchEvent(clickEvent);

  // Check after a small delay
  setTimeout(() => {
    const hasSelAfter = firstRow.classList.contains("sel");
    console.log(`    After click - has .sel: ${hasSelAfter}`);
    if (hasSelAfter && !hasSelBefore) {
      console.log(`    ✅ Click event was processed`);
    } else if (hasSelAfter) {
      console.log(`    ℹ️ Row was already selected`);
    } else {
      console.log(`    ❌ Click event did not update selection`);
    }
  }, 100);
}

// ============= Keyboard Test =============
console.log("\n⌨️ Keyboard Test:");
console.log("  Attempting to focus list...");
if (list) {
  list.focus({ preventScroll: true });
  const focused = document.activeElement === list;
  console.log(`  ${focused ? "✅" : "❌"} List focused: ${focused}`);
  console.log("  Try pressing: Arrow Up/Down, Home, End, Escape");
}

// ============= Summary =============
console.log("\n📊 Summary:");
console.log(
  `  Pointer Events: ${pointerEventsOk ? "✅ OK" : "❌ ISSUES FOUND"}`,
);
console.log(
  `  List Focus: ${isFocused ? "✅ OK" : "⚠️ NOT FOCUSED - click list and try again"}`,
);
console.log(`  Rows Rendered: ${rows.length > 0 ? "✅ YES" : "❌ NO"}`);
console.log(
  `  Events: ${typeof getEventListeners === "function" ? "✅ Checkable" : "⚠️ Use Chrome/Edge"}`,
);

// ============= Troubleshooting =============
if (!pointerEventsOk || !isFocused || rows.length === 0) {
  console.log("\n⚠️ ISSUES DETECTED - Troubleshooting:");

  if (!isFocused) {
    console.log("  1. Click on a row to focus the list");
    console.log("  2. Then try clicking again");
  }

  if (rows.length === 0) {
    console.log("  1. Load some log files first");
    console.log("  2. The list should populate with rows");
  }

  if (!pointerEventsOk) {
    console.log("  1. Check if CSS was properly loaded");
    console.log("  2. Check Network tab for CSS errors");
    console.log("  3. Refresh the page (Ctrl+Shift+R hard refresh)");
  }
}

console.log("\n✅ Debug script complete!");
console.log("For more details, see: VERIFICATION_GUIDE.md");
