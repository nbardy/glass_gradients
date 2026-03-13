/**
 * dense-controls — transforms a plain HTML form into a compact bar-style UI.
 *
 * Expects a <form> (or any container) with standard inputs:
 *   <label><span>Name</span><input type="range" ...></label>
 *   <label><span>Name</span><input type="checkbox" ...></label>
 *   <label><span>Name</span><select>...</select></label>
 *
 * Call DenseControls.init(container, opts?) to transform them in-place.
 * Returns a DenseControls instance with .get(), .set(), .on(), .destroy().
 */

export class DenseControls {
  /** @type {HTMLElement} */
  #root;
  /** @type {Map<string, HTMLInputElement | HTMLSelectElement>} */
  #inputs = new Map();
  /** @type {Map<string, { bar: HTMLElement, input: HTMLInputElement }>} */
  #bars = new Map();
  /** @type {Map<string, number>} */
  #digits = new Map();
  /** @type {((key: string, value: number | boolean) => void)[]} */
  #listeners = [];
  /** @type {AbortController} */
  #ac = new AbortController();

  /**
   * @param {HTMLElement} container
   * @param {{ digits?: Record<string, number>, keyAttr?: string }} opts
   *   digits: decimal places per key for bar value display (default: auto from step)
   *   keyAttr: data attribute name used to identify settings (default: "setting")
   */
  static init(container, opts = {}) {
    return new DenseControls(container, opts);
  }

  constructor(root, opts) {
    this.#root = root;
    root.classList.add("dense-controls");

    const keyAttr = opts.keyAttr ?? "setting";
    const digitOverrides = opts.digits ?? {};

    // Collect all inputs keyed by data-{keyAttr}
    root.querySelectorAll(`[data-${keyAttr}]`).forEach((input) => {
      const key = input.dataset[keyAttr];
      this.#inputs.set(key, input);

      if (digitOverrides[key] != null) {
        this.#digits.set(key, digitOverrides[key]);
      }
    });

    // Transform each <label> based on input type
    for (const [key, input] of this.#inputs) {
      const label = input.closest("label");
      if (input.type === "range") {
        this.#transformRange(key, input, label);
      } else if (input.type === "checkbox") {
        this.#transformCheckbox(key, input, label);
      } else if (input.tagName === "SELECT") {
        this.#transformSelect(key, input, label);
      }
    }

    this.#syncAllBars();
  }

  // -- Public API --

  /** Read the current value of a control by key. */
  get(key) {
    const input = this.#inputs.get(key);
    if (!input) return undefined;
    if (input.type === "checkbox") return input.checked;
    return Number(input.value);
  }

  /** Programmatically set a control value and update the UI. */
  set(key, value) {
    const input = this.#inputs.get(key);
    if (!input) return;
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else {
      input.value = String(value);
    }
    this.#syncBar(key);
    this.#emit(key);
  }

  /** Register a change listener: fn(key, value). */
  on(event, fn) {
    if (event === "change") this.#listeners.push(fn);
  }

  /** Remove all event listeners and undo DOM transforms. */
  destroy() {
    this.#ac.abort();
    this.#listeners.length = 0;
  }

  // -- Transforms --

  #transformRange(key, input, label) {
    const nameSpan = label?.querySelector("span");
    const name = nameSpan?.textContent ?? key;

    // Determine decimal digits from step if not overridden
    if (!this.#digits.has(key)) {
      const step = input.step || "1";
      const decimals = (step.split(".")[1] || "").length;
      this.#digits.set(key, decimals);
    }

    // Build bar structure
    const bar = document.createElement("div");
    bar.className = "dc-bar";
    bar.dataset.bar = key;

    const fill = document.createElement("div");
    fill.className = "dc-fill";

    const labelDiv = document.createElement("div");
    labelDiv.className = "dc-label";

    const nameEl = document.createElement("span");
    nameEl.textContent = name;

    const valueEl = document.createElement("span");
    valueEl.className = "dc-value";
    valueEl.dataset.output = key;

    labelDiv.append(nameEl, valueEl);
    bar.append(fill, labelDiv, input);

    // Replace the original label with the bar
    if (label) {
      label.replaceWith(bar);
    } else {
      this.#root.append(bar);
    }

    this.#bars.set(key, { bar, input });

    // Remove any leftover <output> elements
    const oldOutput = this.#root.querySelector(`output[data-output="${key}"]`);
    if (oldOutput) oldOutput.remove();

    input.addEventListener("input", () => {
      this.#syncBar(key);
      this.#emit(key);
    }, { signal: this.#ac.signal });
  }

  #transformCheckbox(key, input, label) {
    if (label) {
      label.className = "dc-toggle";
    }
    input.addEventListener("change", () => {
      this.#emit(key);
    }, { signal: this.#ac.signal });
  }

  #transformSelect(key, input, label) {
    if (label) {
      label.className = "dc-select";
    }
    input.addEventListener("change", () => {
      this.#emit(key);
    }, { signal: this.#ac.signal });
  }

  // -- Internal --

  #syncBar(key) {
    const entry = this.#bars.get(key);
    if (!entry) return;
    const { bar, input } = entry;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    bar.style.setProperty("--fill", `${pct}%`);

    const digits = this.#digits.get(key) ?? 2;
    const valueEl = bar.querySelector(".dc-value");
    if (valueEl) valueEl.textContent = val.toFixed(digits);
  }

  #syncAllBars() {
    for (const key of this.#bars.keys()) {
      this.#syncBar(key);
    }
  }

  #emit(key) {
    const value = this.get(key);
    for (const fn of this.#listeners) {
      fn(key, value);
    }
  }
}
