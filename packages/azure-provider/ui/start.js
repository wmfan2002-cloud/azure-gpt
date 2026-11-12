(async () => {
  await magpie.ready
  const options = await magpie.options.get()
  location.replace(magpie.service || `http://127.0.0.1:${options.uiPort ?? 3487}/`)
})().catch((error) => { document.querySelector("p").textContent = error.message })
