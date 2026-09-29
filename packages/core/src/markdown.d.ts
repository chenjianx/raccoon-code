declare module "*.md" {
  const content: string
  export default content
}

// raccoon_change start - bundle the knowledge skill Python client as text
declare module "*.py" {
  const content: string
  export default content
}
// raccoon_change end
