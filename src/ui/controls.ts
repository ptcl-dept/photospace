export function bindButtonGroup(ids: string[], onSelect: (index: number) => void): void {
  const els = ids.map((id) => document.getElementById(id) as HTMLButtonElement);
  els.forEach((el, i) => {
    el.onclick = () => {
      onSelect(i);
      els.forEach((e, j) => e.classList.toggle("act", j === i));
    };
  });
}

export function bindSlider(
  id: string,
  outId: string,
  onInput: (value: number) => void,
  fmt: (value: number) => string,
): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const out = document.getElementById(outId)!;
  el.oninput = () => {
    const v = parseFloat(el.value);
    onInput(v);
    out.textContent = fmt(v);
  };
}
