import "./types";
import { template, attr, notify, observe } from "../../annotations/polymer";

import "script!bower_components/jquery/jquery.js";
import "script!bower_components/mathquill/mathquill.js";

export interface ICmd {
  cmd: string;
  name: string;
  className?: string;
}

export interface PolymerEvent extends Event {
  model: any;
}

@component("input-math")
@template("<input>")
export class InputMath extends Polymer.Element {
  static HISTORY_SIZE: number = 20;

  static SYMBOLS_BASIC: ICmd[] = [
    { cmd: "\\sqrt", name: "√" },
    { cmd: "\\nthroot", name: "√", className: "n-sup" },
    { cmd: "\\int", name: "∫" },
    { cmd: "^", name: "n", className: "sup" },
    { cmd: "_", name: "n", className: "sub" },
    { cmd: "\\rightarrow", name: "→" },
    { cmd: "\\infty", name: "∞" },
    { cmd: "\\neq", name: "≠" },
    { cmd: "\\degree", name: "°" },
    { cmd: "\\div", name: "÷" }
  ];

  static SYMBOLS_GREEK: ICmd[] = [
    { cmd: "\\lambda", name: "λ" },
    { cmd: "\\pi", name: "π" },
    { cmd: "\\mu", name: "μ" },
    { cmd: "\\sum", name: "Σ" },
    { cmd: "\\alpha", name: "α" },
    { cmd: "\\beta", name: "β" },
    { cmd: "\\gamma", name: "γ" },
    { cmd: "\\delta", name: "ᵟ", className: "big" },
    { cmd: "\\Delta", name: "Δ" }
  ];

  static SYMBOLS_PHYSICS: ICmd[] = [
    { cmd: "\\ohm", name: "Ω" },
    { cmd: "\\phi", name: "ᶲ", className: "big" }
  ];

  testValue: "yep"|"nope";

  @attr value: string|null = "";

  @notify symbols: ICmd[][] = [
    InputMath.SYMBOLS_BASIC,
    InputMath.SYMBOLS_GREEK
  ];

  showSymbols: string = "";

  private _history: string[];
  private _mathField: MathQuill.EditableField;
  private _observerLocked: boolean = false;
  private _freezeHistory: boolean = false;
  private _editor: HTMLElement = document.createElement("div");

  constructor() {
    super();
    var editor: HTMLElement = this._editor;
    editor.id = "editor";
    editor.classList.add(this.is);
    this["_mathField"] = MathQuill.getInterface(2).MathField(editor, {
      spaceBehavesLikeTab: true,
      handlers: {
        edit: this._updateValue.bind(this)
      }
    });
  }

  ready(): void {
    this.insertBefore(this._editor, this.$.controls);
  }

  cmd(ev: PolymerEvent): void {
    this._mathField.cmd(ev.model.item.cmd).focus();
  }

  undo(): void {
    if (this._history && this._history.length > 0) {
      this._freezeHistory = true;
      this.value = this._history.pop();
      this._freezeHistory = false;
    }
  }

  @observe("value")
  valueChanged(value: string, prevValue: string): Array<{test: boolean}> {
    this._updateHistory(prevValue);

    if (this._observerLocked) {
      return;
    }

    this._mathField.select().write(value);
    if (this._mathField.latex() === "") {
      this.undo();
    }
  }

  @observe("showSymbols")
  symbolsChanged(symbols: string): void {
    if (symbols) {
      this.symbols = symbols.split(",").map(groupName => {
        return InputMath[ "SYMBOLS_" + groupName.toUpperCase() ] || [];
      });
    }
  }

  @listen("keydown")
  keyShortcuts(ev: KeyboardEvent): void {
    if (ev.ctrlKey && ev.keyCode === 90) {
      this.undo();
    }
  }

  _updateValue(test: {a: () => void, b: any}): void {
    console.log(test);
    this._observerLocked = true;
    this.value = this._mathField.latex();
    this._observerLocked = false;
  }

  private _updateHistory(prevValue: string): void {
    if (!this._history) {
      this._history = [];
    }

    if (this._freezeHistory || prevValue == null) {
      return;
    }

    this._history.push(prevValue);
    if (this._history.length > InputMath.HISTORY_SIZE) {
      this._history.shift();
    }
  }
}
