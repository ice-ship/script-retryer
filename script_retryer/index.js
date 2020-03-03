"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const tl = require("azure-pipelines-task-lib/task");
var uuidV4 = require('uuid/v4');
function translateDirectoryPath(directoryFormat, directoryPath) {
    return __awaiter(this, void 0, void 0, function* () {
        let commandPath = tl.which("bash", true);
        let commandPwd = tl.tool(commandPath)
            .arg('--noprofile')
            .arg('--norc')
            .arg('-c')
            .arg('pwd');
        if (directoryFormat == 'WINDOWS') {
            commandPath = tl.which("cmd", true);
            commandPwd = tl.tool(commandPath)
                .arg('/D')
                .arg('/E:ON')
                .arg('/V:OFF')
                .arg('/S')
                .arg('/C')
                .arg('cd');
        }
        let commandPwdOptions = {
            cwd: directoryPath,
            failOnStdErr: true,
            errStream: process.stdout,
            outStream: process.stdout,
            ignoreReturnCode: false
        };
        let commandOutput = '';
        commandPwd.on('stdout', (data) => {
            commandOutput += data.toString();
        });
        yield commandPwd.exec(commandPwdOptions);
        commandOutput = commandOutput.trim();
        if (!commandOutput) {
            throw new Error(tl.loc('JS_TranslatePathFailed', directoryPath));
        }
        return `${commandOutput}`;
    });
}
function sleep(ms) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            tl.setResourcePath(path.join(__dirname, 'task.json'));
            // Get inputs.
            let input_failOnStderr = tl.getBoolInput('failOnStderr', false);
            let input_workingDirectory = tl.getPathInput('workingDirectory', /*required*/ true, /*check*/ true);
            let input_filePath;
            let input_arguments;
            let input_script;
            let input_targetType = tl.getInput('targetType') || '';
            let input_directoryFormat = tl.getInput('directoryFormat') || 'unix';
            let input_targetInterperter = tl.getInput('targetInterperter') || 'bash';
            let input_scriptExtension = tl.getInput('scriptExtension') || '';
            let input_delay = parseInt(tl.getInput('delay'));
            let input_retryTimes = parseInt(tl.getInput('retryTimes'));
            if (isNaN(input_delay)) {
                throw new Error(tl.loc('JS_InvalidInput', "delay"));
            }
            if (isNaN(input_retryTimes)) {
                throw new Error(tl.loc('JS_InvalidInput', "retry"));
            }
            if (input_targetType.toUpperCase() == 'FILEPATH') {
                input_filePath = tl.getPathInput('filePath', /*required*/ true);
                if (!tl.stats(input_filePath).isFile()) {
                    throw new Error(tl.loc('JS_InvalidFilePath', input_filePath));
                }
                input_arguments = tl.getInput('arguments') || '';
            }
            else {
                input_script = tl.getInput('script', false) || '';
            }
            // Generate the script contents.
            console.log(tl.loc('GeneratingScript'));
            let interpreterPath = tl.which(input_targetInterperter, true);
            let contents;
            if (input_targetType.toUpperCase() == 'FILEPATH') {
                let targetFilePath;
                if (process.platform == 'win32') {
                    targetFilePath = (yield translateDirectoryPath(input_directoryFormat.toUpperCase(), path.dirname(input_filePath))) + '/' + path.basename(input_filePath);
                }
                else {
                    targetFilePath = input_filePath;
                }
                // Check if executable bit is set
                const stats = tl.stats(input_filePath);
                // Check file's executable bit.
                if ((stats.mode & 1) > 0) {
                    contents = `${input_targetInterperter} '${targetFilePath.replace("'", "'\\''")}' ${input_arguments}`.trim();
                }
                else {
                    tl.debug(`File permissions: ${stats.mode}`);
                    throw new Error(tl.loc('JS_MissingExecutableBit'));
                }
                console.log(tl.loc('JS_FormattedCommand', contents));
            }
            else {
                contents = input_script;
                // Print one-liner scripts.
                if (contents.indexOf('\n') < 0 && contents.toUpperCase().indexOf('##VSO[') < 0) {
                    console.log(tl.loc('JS_ScriptContents'));
                    console.log(contents);
                }
            }
            // Write the script to disk.
            tl.assertAgent('2.115.0');
            let tempDirectory = tl.getVariable('agent.tempDirectory');
            tl.checkPath(tempDirectory, `${tempDirectory} (agent.tempDirectory)`);
            let fileName = uuidV4();
            if (input_scriptExtension != "") {
                fileName = fileName + "." + input_scriptExtension;
            }
            let filePath = path.join(tempDirectory, fileName);
            yield fs.writeFileSync(filePath, contents, { encoding: 'utf8' });
            // Translate the script file path from Windows to the Linux file system.
            if (process.platform == 'win32') {
                let pathLimiter = '/';
                if (input_directoryFormat.toUpperCase() == 'WINDOWS') {
                    pathLimiter = '\\';
                }
                filePath = (yield translateDirectoryPath(input_directoryFormat.toUpperCase(), tempDirectory)) + pathLimiter + fileName;
            }
            // Create the tool runner.
            console.log('========================== Starting Command Output ===========================');
            let interpreter = tl.tool(interpreterPath);
            interpreter.arg(filePath);
            let options = {
                cwd: input_workingDirectory,
                failOnStdErr: false,
                errStream: process.stdout,
                outStream: process.stdout,
                ignoreReturnCode: true
            };
            // Listen for stderr.
            let stderrFailure = false;
            const aggregatedStderr = [];
            if (input_failOnStderr) {
                interpreter.on('stderr', (data) => {
                    stderrFailure = true;
                    // Truncate to at most 10 error messages
                    if (aggregatedStderr.length < 10) {
                        // Truncate to at most 1000 bytes
                        if (data.length > 1000) {
                            aggregatedStderr.push(`${data.toString('utf8', 0, 1000)}<truncated>`);
                        }
                        else {
                            aggregatedStderr.push(data.toString('utf8'));
                        }
                    }
                    else if (aggregatedStderr.length === 10) {
                        aggregatedStderr.push('Additional writes to stderr truncated');
                    }
                });
            }
            let runTimes = 1;
            let runSuccess = false;
            let result = tl.TaskResult.Succeeded;
            while (runTimes < input_retryTimes + 1 && !runSuccess) {
                result = tl.TaskResult.Succeeded;
                runSuccess = true;
                // Run script
                let exitCode = yield interpreter.exec(options);
                // Fail on exit code.
                if (exitCode !== 0) {
                    tl.debug(tl.loc('JS_ExitCode', exitCode));
                    result = tl.TaskResult.Failed;
                }
                // Fail on stderr.
                if (stderrFailure) {
                    tl.debug(tl.loc('JS_Stderr'));
                    aggregatedStderr.forEach((err) => {
                        tl.debug(err);
                    });
                    result = tl.TaskResult.Failed;
                }
                if (result == tl.TaskResult.Failed) {
                    console.log(tl.loc('ErrorDetected', runTimes));
                    console.log(tl.loc('Waiting', input_delay));
                    runTimes = runTimes + 1;
                    runSuccess = false;
                    stderrFailure = false;
                    yield sleep(input_delay * 1000);
                }
            }
            tl.setResult(result, null, true);
        }
        catch (err) {
            tl.setResult(tl.TaskResult.Failed, err.message || 'run() failed', true);
        }
    });
}
run();
