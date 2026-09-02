import React from "react";

export function Button({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <button className="primary-button" data-testid={testId}>
      {children}
    </button>
  );
}
