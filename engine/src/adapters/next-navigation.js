// Stand-in for next/navigation. The film never navigates: router actions do nothing and the route is fixed.
const inert = () => undefined;
const frozenRouter = Object.freeze({push: inert, replace: inert, back: inert, forward: inert, refresh: inert, prefetch: inert});

export const useRouter = () => frozenRouter;
export const usePathname = () => '/';
export const useSearchParams = () => new URLSearchParams('');
export const useParams = () => Object.create(null);
export const redirect = inert;
export const notFound = inert;
