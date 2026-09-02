import React, { Suspense, forwardRef, memo } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Button } from "./components/ui/react-qa-button";

const PrimaryButton = memo(
  forwardRef<HTMLButtonElement, { label: string }>(function PrimaryButton({ label }, ref) {
    return (
      <button ref={ref} className="primary-button" data-testid="react-primary">
        {label}
      </button>
    );
  }),
);

function ResultRow({ result }: { result: { id: string; name: string; score: string } }) {
  return (
    <div className="row" data-testid={`row-${result.id}`}>
      <span>{result.name}</span>
      <strong>{result.score}</strong>
    </div>
  );
}

function ResultList() {
  const results = [
    { id: "one", name: "Pricing comparison", score: "Ready" },
    { id: "two", name: "Source review", score: "Pending" },
  ];
  return (
    <div>
      {results.map((result) => (
        <ResultRow key={result.id} result={result} />
      ))}
    </div>
  );
}

function ProjectHeader() {
  return (
    <header>
      <h1>React QA Fixture</h1>
      <p>Nested component inspection target</p>
      <PrimaryButton label="Review primary action" />
    </header>
  );
}

function FeatureAction() {
  return <Button testId="shared-ui-button">Shared UI action</Button>;
}

function PortalAction() {
  const root = document.getElementById("portal-root");
  if (!root) return null;
  return createPortal(
    <button className="portal-button" data-testid="portal-button">
      Portal action
    </button>,
    root,
  );
}

function ProjectPage() {
  return (
    <section>
      <ProjectHeader />
      <Suspense fallback={<span>Loading</span>}>
        <ResultList />
      </Suspense>
      <FeatureAction />
      <PortalAction />
    </section>
  );
}

function SecondaryRoot() {
  return (
    <section>
      <h2>Second root</h2>
      <button data-testid="second-root-button">Second root action</button>
    </section>
  );
}

createRoot(document.getElementById("react-root-a")!).render(<ProjectPage />);
createRoot(document.getElementById("react-root-b")!).render(<SecondaryRoot />);
