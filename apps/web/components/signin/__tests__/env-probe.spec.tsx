/**
 * @jest-environment ./components/signin/jest-jsdom-environment
 */

/**
 * Guard for `components/signin/jest-jsdom-environment.js`.
 *
 * The shared `jest.config.js` must keep its defensive `node` fallback because
 * `jest-environment-jsdom` is not installed in this workspace — only `jsdom`
 * itself is. Component specs therefore pin the custom environment through the
 * docblock above. If that environment ever breaks, every sign-in spec fails
 * with an unrelated-looking error, so this suite asserts the DOM contract it is
 * supposed to provide: a document, a window, focus management and React's event
 * system all working.
 *
 * (The filename is a leftover from the throwaway probe used to discover which
 * modules this workspace actually resolves; the file now guards the environment
 * that discovery produced.)
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

/** A control that focuses and reports a click, exercising both code paths. */
function ProbeControl() {
  const [clicked, setClicked] = useState(false);
  return (
    <div>
      <label htmlFor="probe-input">Probe</label>
      <input
        id="probe-input"
        type="text"
        onFocus={() => setClicked(false)}
        onChange={() => undefined}
      />
      <button type="button" onClick={() => setClicked(true)}>
        Probe button
      </button>
      <p>{clicked ? "clicked" : "idle"}</p>
    </div>
  );
}

describe("custom jsdom test environment", () => {
  it("provides the DOM, focus and event plumbing the component specs rely on", () => {
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
    expect(document.body).toBeInstanceOf(HTMLElement);

    render(<ProbeControl />);

    const field = screen.getByLabelText("Probe");
    expect(field).toBeInTheDocument();

    // `HTMLElement.focus()` is what moves `document.activeElement`; a bare
    // `focus` event dispatch does not.
    field.focus();
    expect(field).toHaveFocus();

    const button = screen.getByRole("button", { name: "Probe button" });
    fireEvent.click(button);
    expect(screen.getByText("clicked")).toBeInTheDocument();

    // ARIA role queries need the full DOM hierarchy, not just `document`.
    expect(screen.getByRole("textbox")).toBe(field);
  });
});
