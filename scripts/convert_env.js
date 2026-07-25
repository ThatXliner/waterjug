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
const output = new Map();

for (let keyValue of stdin.matchAll(/(\w+)="(.+)"/gm)) {
	const key = keyValue[1];
	const value = keyValue[2];
	if (Object.prototype.hasOwnProperty.call(REMAP, key)) {
		output.set(REMAP[key], value);
	} else {
		output.set(key, value);
	}
}

for (const requiredKey of Object.values(REMAP)) {
	if (!output.has(requiredKey)) {
		throw new Error(`Supabase status did not provide ${requiredKey}`);
	}
}

for (const [key, value] of output) {
	console.log(`${key}=${value}`);
}
