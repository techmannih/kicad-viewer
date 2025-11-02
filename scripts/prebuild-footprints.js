import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { parseKicadModToTscircuitSoup } from "kicad-mod-converter";

const BASE_URL = "https://kicad-mod-cache.tscircuit.com";

function isNetworkUnreachable(error) {
        if (!error) return false;
        const code = error.code ?? error?.cause?.code ?? error?.cause?.errors?.[0]?.code;
        return code === "ENETUNREACH";
}

async function fetchWithTimeout(url, type) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
                const res = await fetch(url, { signal: controller.signal });
                if (!res.ok) {
                        const error = new Error(`Failed to fetch ${url}: ${res.status}`);
                        error.status = res.status;
                        throw error;
                }
                return type === "json" ? res.json() : res.text();
        } catch (error) {
                if (error.name === "AbortError") {
                        throw new Error(`Timed out while fetching ${url}`);
                }
                throw error;
        } finally {
                clearTimeout(timeout);
        }
}

async function fetchJson(url) {
        return fetchWithTimeout(url, "json");
}

async function fetchText(url) {
        return fetchWithTimeout(url, "text");
}

async function main() {
        let files;
        try {
                files = await fetchJson(`${BASE_URL}/kicad_files.json`);
        } catch (error) {
                if (isNetworkUnreachable(error)) {
                        console.warn(
                                "[prebuild-footprints] Network unreachable while fetching KiCad footprints. Skipping prebuild step."
                        );
                        return;
                }
                throw error;
        }
        const missingFiles = [];
        const failedDownloads = [];
        let networkDownloadWarningShown = false;
        for (const file of files) {
                if (!file.endsWith(".kicad_mod")) continue;
                const content = await fetchText(`${BASE_URL}/${file}`).catch((error) => {
                        if (isNetworkUnreachable(error)) {
                                if (!networkDownloadWarningShown) {
                                        console.warn(
                                                "[prebuild-footprints] Network unreachable while downloading KiCad footprints. " +
                                                        "Skipping remaining downloads."
                                        );
                                        networkDownloadWarningShown = true;
                                }
                                return null;
                        }
                        if (error.status === 404) {
                                missingFiles.push(file);
                                return null;
                        }
                        console.warn(
                                `[prebuild-footprints] Failed to download ${file}: ${error.message ?? error}`
                        );
                        failedDownloads.push(file);
                        return null;
                });
                if (!content) continue;
                const soup = await parseKicadModToTscircuitSoup(content);
                const outPath = join(
                        "public",
			"circuit-json",
			file.replace(/\.kicad_mod$/, ".json"),
		);
                await mkdir(dirname(outPath), { recursive: true });
                await writeFile(outPath, JSON.stringify(soup, null, 2), "utf8");
        }
        if (missingFiles.length > 0) {
                console.warn(
                        `[prebuild-footprints] Skipped ${missingFiles.length} missing footprint${
                                missingFiles.length === 1 ? "" : "s"
                        } (404).`
                );
                if (missingFiles.length <= 10) {
                        for (const file of missingFiles) {
                                console.warn(`  • ${file}`);
                        }
                }
        }
        if (failedDownloads.length > 0) {
                console.warn(
                        `[prebuild-footprints] Encountered ${failedDownloads.length} other download failure${
                                failedDownloads.length === 1 ? "" : "s"
                        }. See logs above for details.`
                );
        }
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
