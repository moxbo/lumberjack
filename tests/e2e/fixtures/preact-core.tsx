import { createContext, render } from "preact";
import { useContext, useState } from "preact/hooks";
import { Tooltip } from "../../../src/renderer/components/Tooltip";
import { ErrorBoundary } from "../../../src/renderer/ErrorBoundary";

const PortalContext = createContext("missing provider");
let root: HTMLDivElement;

function PortalContent({ onActivate }: { onActivate: () => void }) {
  const value = useContext(PortalContext);
  return (
    <div>
      <p>{value}</p>
      <button onClick={onActivate}>Portal action</button>
    </div>
  );
}

function Example() {
  const [clicks, setClicks] = useState(0);
  return (
    <PortalContext.Provider value="provided through portal">
      <Tooltip
        text={
          <PortalContent onActivate={() => setClicks((value) => value + 1)} />
        }
        position="bottom"
        delay={0}
        interactive
        label="Core tooltip"
      >
        <button id="core-portal-trigger">Core trigger</button>
      </Tooltip>
      <output id="core-portal-clicks">{clicks}</output>
    </PortalContext.Provider>
  );
}

export function mount() {
  root = document.createElement("div");
  root.id = "preact-core-fixture";
  root.style.cssText =
    "position:fixed;top:120px;left:240px;z-index:20000;display:flex";
  document.body.append(root);
  render(<Example />, root);
}

export function unmount() {
  render(null, root);
  root.remove();
}

export function mountBoundary(kind: "null" | "undefined" | "error") {
  root = document.createElement("div");
  document.body.prepend(root);
  let recovered = false;
  function Child() {
    if (!recovered) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- The regression test must throw the original null or undefined.
      throw kind === "null"
        ? null
        : kind === "error"
          ? new TypeError("fixture")
          : undefined;
    }
    return <output id="boundary-recovered">Recovered</output>;
  }
  render(
    <ErrorBoundary
      fallback={(error, reset) => (
        <button
          onClick={() => {
            recovered = true;
            reset();
          }}
        >
          {error.name}: {error.message}
        </button>
      )}
    >
      <Child />
    </ErrorBoundary>,
    root,
  );
}
