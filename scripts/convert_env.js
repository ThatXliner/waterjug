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
for (const keyValue of stdin.matchAll(/^(\w+)=(?:"([^"]*)"|([^\r\n]*))$/gm)) {
	const key = keyValue[1];
	const value = keyValue[2] ?? keyValue[3];
	if (Object.prototype.hasOwnProperty.call(REMAP, key)) {
		console.log(`${REMAP[key]}=${value}`);
	} else {
		console.log(`${key}=${value}`);
	}
}
