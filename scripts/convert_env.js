import { readFile } from 'fs';

const readFilePromise = (...args) =>
	new Promise((resolve, reject) => {
		readFile(...args, (error, result) => {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		});
	});

const stdin = await readFilePromise(process.stdin.fd, 'utf-8');
const REMAP = {
	API_URL: 'PUBLIC_SUPABASE_URL',
	ANON_KEY: 'PUBLIC_SUPABASE_ANON_KEY',
	SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY'
};

let entries;
try {
	const parsed = JSON.parse(stdin);
	entries =
		parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
			? Object.entries(parsed)
			: [];
} catch {
	entries = Array.from(stdin.matchAll(/^(\w+)=(?:"([^"]*)"|([^\r\n]*))$/gm), (keyValue) => [
		keyValue[1],
		keyValue[2] ?? keyValue[3]
	]);
}

for (const [key, rawValue] of entries) {
	const value = String(rawValue);
	if (Object.prototype.hasOwnProperty.call(REMAP, key)) {
		console.log(`${REMAP[key]}=${value}`);
	} else {
		console.log(`${key}=${value}`);
	}
}
