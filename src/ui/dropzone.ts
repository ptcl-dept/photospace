export function bindDropzone(dropEl: HTMLElement, fileInput: HTMLInputElement, onFile: (file: File) => void): void {
  dropEl.onclick = () => fileInput.click();
  ["dragover", "dragenter"].forEach((ev) =>
    dropEl.addEventListener(ev, (e) => {
      e.preventDefault();
      dropEl.classList.add("on");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropEl.addEventListener(ev, (e) => {
      e.preventDefault();
      dropEl.classList.remove("on");
    }),
  );
  dropEl.addEventListener("drop", (e) => {
    const file = (e as DragEvent).dataTransfer?.files[0];
    if (file) onFile(file);
  });
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (file) onFile(file);
  };
}
