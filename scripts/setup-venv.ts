import { existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const DEFAULT_PYPI_INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple";

type PythonCommand = {
  command: string;
  args: string[];
};

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function findPython(): PythonCommand {
  const candidates: PythonCommand[] = [
    { command: "python", args: [] },
    { command: "python3", args: [] },
    { command: "py", args: ["-3"] },
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
      encoding: "utf-8",
      shell: false,
    });
    if (result.status === 0) return candidate;
  }

  console.error("未找到 Python。请先安装 Python 3，并确保 python/python3/py 在 PATH 中。");
  process.exit(1);
}

function findVenvPython(): string {
  const candidates = [
    join(".venv", "Scripts", "python.exe"),
    join(".venv", "bin", "python"),
    join(".venv", "bin", "python3"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  console.error("已创建 .venv，但未找到虚拟环境中的 Python 可执行文件。");
  process.exit(1);
}

function pipIndexArgs(): string[] {
  const indexUrl =
    process.env.PIP_INDEX_URL ||
    process.env.PYPI_INDEX_URL ||
    DEFAULT_PYPI_INDEX_URL;

  const args = [
    "--index-url",
    indexUrl,
    "--retries",
    "5",
    "--timeout",
    "60",
  ];

  const trustedHost = process.env.PIP_TRUSTED_HOST || process.env.PYPI_TRUSTED_HOST;
  if (trustedHost) {
    args.push("--trusted-host", trustedHost);
  }

  console.log(`Using PyPI index: ${indexUrl}`);
  return args;
}

const python = findPython();
run(python.command, [...python.args, "-m", "venv", ".venv"]);

const venvPython = findVenvPython();
const pipArgs = pipIndexArgs();
run(venvPython, ["-m", "pip", "install", ...pipArgs, "--upgrade", "pip"]);
run(venvPython, ["-m", "pip", "install", ...pipArgs, "-r", "requirements.txt"]);
