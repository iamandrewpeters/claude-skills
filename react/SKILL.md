---
name: react
description: "Use for React development. Encodes component architecture decisions, state management philosophy, and the judgment that prevents over-engineered frontend code."
version: 2.0.0
---

# React Development

## Decision Framework

### Before writing a component, decide:

1. **Does this component already exist?** Check the codebase first. Don't reinvent.
2. **How much state does this actually need?** Default: none. Add state only when local UI demands it.
3. **Where does the data come from?** API → fetch it. Parent → prop it. Derived → compute it. Don't store what you can derive.

### State management decisions

| Scenario | Solution |
|---|---|
| Toggle, form input, UI visibility | `useState` — local to the component |
| Data from an API | Fetch hook (TanStack Query or custom `useApi`) — not local state |
| Shared across 2-3 siblings | Lift state to parent, pass down |
| Truly global (auth, theme, feature flags) | Context or Zustand — justify the choice |
| Complex form with many fields | `useReducer` or form library — not 15 `useState` calls |

**Default**: No state management library. Reach for one only when prop drilling genuinely becomes painful across 4+ levels.

---

## Architecture Rules

### Component structure

- Functional components only. No class components.
- Small and flat. Each component understandable in isolation.
- One component per file (unless tightly coupled helper, e.g. a ListItem inside a List).
- Props interface at the top. Named exports.

```tsx
interface Props {
    title: string;
    onAction: () => void;
}

export function Card({ title, onAction }: Props) {
    return (
        <div onClick={onAction}>
            <h2>{title}</h2>
        </div>
    );
}
```

### Hooks

```tsx
const [open, setOpen] = useState(false);

useEffect(() => {
    fetchData();
    return () => cleanup();
}, [dependency]);
```

- No `useEffect` for derived state. Compute it inline or with `useMemo`.
- No `useCallback` / `useMemo` unless there's a measured performance problem.
- Custom hooks for reusable logic — but only when actually reused.

### Custom hook pattern (when justified)

```tsx
function useApi<T>(url: string) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        fetch(url)
            .then(r => r.json())
            .then(setData)
            .catch(setError)
            .finally(() => setLoading(false));
    }, [url]);

    return { data, loading, error };
}
```

---

## Anti-Patterns (Reject These)

| Pattern | Why it's wrong | Do instead |
|---|---|---|
| `useEffect` to sync state from props | Derived state doesn't need an effect | Compute inline: `const x = props.y + 1` |
| Context for everything | Makes components coupled to global state | Props first. Context only for truly global concerns |
| `useMemo`/`useCallback` everywhere | Premature optimization adds complexity | Only when profiler shows actual re-render cost |
| Deeply nested component trees (5+ levels) | Hard to trace data flow, hard to debug | Flatten. Compose at the page level |
| Separate files for tiny styled wrappers | File proliferation with no benefit | Inline or co-locate |
| `index.ts` barrel files | Breaks tree-shaking, obscures imports | Import directly from the source file |
| Type `any` to silence TypeScript | Hides bugs | Use proper types or `unknown` with narrowing |

---

## Libraries (Use Sparingly)

- **React Router** — if routing needed (SPA)
- **TanStack Query** — if significant API data fetching
- **Zustand** — if global state genuinely needed (prefer Context first)
- **Tailwind CSS** — utility classes over custom CSS when project uses it

**Don't add**: Redux, MobX, Styled Components, Emotion, or any library that adds abstraction without solving a measured problem in this codebase.

---

## Quality Gates

Before presenting React code:

- [ ] Could this component be split? (If it's over 80 lines, probably yes)
- [ ] Is there state that could be derived instead of stored?
- [ ] Did I add a dependency that the project doesn't already use?
- [ ] Does every component handle loading, empty, and error states where applicable?
- [ ] Are there any `useEffect` calls that could be replaced with event handlers or derived values?
