import { isUuid } from '$lib/uuid';

/** @type {import('@sveltejs/kit').ParamMatcher} */
export function match(param: string) {
	return isUuid(param);
}
