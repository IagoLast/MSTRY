# Electree

Una V0 de Electron + TypeScript para trabajar con `git worktree` o, si no hay repo, simplemente abrir una carpeta con terminal integrado.

## Qué hace ahora

- Usa una UI minimalista con base de componentes estilo `shadcn/ui`.
- Acepta como root tanto un repo Git como una carpeta normal.
- Si el root es Git, lista worktrees, crea nuevos y permite borrar los enlazados.
- Si el root no es Git, expone la carpeta como un único workspace con terminal.
- Abre una shell embebida en el item seleccionado.

## Desarrollo

```bash
npm install
npm run dev
```

## Notas

- La ruta del workspace se guarda en el directorio de datos de usuario de Electron.
- Los worktrees nuevos se crean en `.claude-worktrees/<repo>/<branch>`.
- El borrado sigue usando `git worktree remove` sin `--force`.
