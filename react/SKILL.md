---
name: react
description: Use this skill when working on React development tasks including components, hooks, state management, context, routing, API calls, TypeScript with React, or debugging React applications.
version: 1.0.0
---

# React Development Skill

## Patterns

### Functional Component

```tsx
interface Props {
  title: string;
  children?: React.ReactNode;
}

export function MyComponent({ title, children }: Props) {
  return (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}
```

### Common Hooks

```tsx
// State
const [value, setValue] = useState<string>('');

// Side effects
useEffect(() => {
  fetchData();
  return () => cleanup();
}, [dependency]);

// Memoization
const computed = useMemo(() => expensiveCalc(data), [data]);
const stableCallback = useCallback(() => handler(id), [id]);

// Refs
const ref = useRef<HTMLDivElement>(null);
```

### Custom Hook Pattern

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

### Context Pattern

```tsx
const MyContext = createContext<MyContextType | null>(null);

export function MyProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialState);
  return (
    <MyContext.Provider value={{ state, setState }}>
      {children}
    </MyContext.Provider>
  );
}

export function useMyContext() {
  const ctx = useContext(MyContext);
  if (!ctx) throw new Error('Must be used within MyProvider');
  return ctx;
}
```

## Common Libraries

- **React Router** — client-side routing (`useNavigate`, `useParams`, `<Link>`)
- **TanStack Query** — server state / data fetching
- **Zustand** — lightweight global state
- **Tailwind CSS** — utility-first styling

## Debugging

- React DevTools browser extension
- `console.log` inside render to track re-renders
- `useEffect` dependency array issues are common — double-check deps
- StrictMode causes double-rendering in dev — expected behavior
