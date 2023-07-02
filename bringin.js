#!/usr/bin/env node

const fs = require("fs-extra");
const stringify = require("json-converters").stringify
const parse = require("json-converters").parse
const shell = require('shelljs')
const path = require('path')

const MAX_RECURSION_DEPTH = 8 //safety feature incase get circular dependencies or something


// --isRoot argument to specify command is being called from the root package
//
// PRE REQUISITES
// -root json has to explicitly lay out every package directory, cba handling "*" or "**" atm
// -Will copy packages even if package is a child
//
// -RECURSION IS DUMN:
//   -Any CIRCULAR DEPENDENCIES WILL CAUSE ISSUES
//   -Will copy local packages inside local package even if that was already copied on previous level of recursion

// TO DO:


////SET UP AND GO
go()
async function go() {

    const [...args] = process.argv

    // Delete current local-packages folder
    await fs.remove(`${process.cwd()}/local-packages`);

    //console.log("\nCurrent Working Directory:", process.cwd())

    const packageJsonPath = `${process.cwd()}/package.json`;
    const packageJson = parse(await fs.readFile(packageJsonPath));

    ///////// GET ROOT PACKAGE NAME
    const rootPackageName = getRootPackageName(packageJson)

    ///////// GET ROOT PACKAGE PATH
    let rootPackagePath = ""

    if (args[2] == "--isRoot") {
        rootPackagePath = process.cwd() + "/package.json"
    }
    else {
        rootPackagePath = await findRootPackagePath(process.cwd(), rootPackageName);
    }

    if (!rootPackagePath) { throw Error('Could Not Find Root package.json') }

    console.log(`\nRoot Package "${rootPackageName}" Found!`)
    //console.log(`\n${path.dirname(rootPackagePath)}`)

    const rootPackageJson = parse(await fs.readFile(rootPackagePath));

    const localDependencies = await bringIn(process.cwd(), path.dirname(rootPackagePath), rootPackageJson, 0, `${process.cwd()}/local-packages`)

    // Save the local file dependencies to json so can be rewritten after
    await fs.writeFile(`${process.cwd()}/local-dependency-map.json`, stringify(localDependencies));
}

////////////
/// THE RECURSIVE FUNCTION
///////////////
async function bringIn(targetPackageDir, rootPackageDir, rootPackageJson, recursionDepth, pasteLocation, alreadyCopied = []) {

    const targetPackageJsonPath = `${targetPackageDir}/package.json`;
    const targetPackageJson = parse(await fs.readFile(targetPackageJsonPath));

    ////// GET LOCAL DEPENDENCIES
    const localDependencies = await getLocalDependencies(targetPackageDir, rootPackageJson.name);

    //
    if (![...localDependencies.keys()].length) { return }
    if (recursionDepth >= MAX_RECURSION_DEPTH) { throw Error(`Max recursion depth of ${MAX_RECURSION_DEPTH} reached bring in ${targetPackageJson.name}`) }


    ////// FIND LOCAL DEPENDENCY PACKAGES
    const localDependencyPaths = await findLocalDependencyPaths([...localDependencies.keys()], rootPackageDir, rootPackageJson.workspaces)

    console.log("\nDependency Packages Found!")
    console.log(localDependencyPaths)


    /////// REWRITE PACKAGE JSON 
    await rewritePackageJson(targetPackageDir, targetPackageJson, [...localDependencies.keys()], !recursionDepth)

    
    for (var depName of [...localDependencyPaths.keys()]) {

        if(alreadyCopied.includes(depName)){
            continue
        }
        
         ///// COPY INTO PACKAGE
        alreadyCopied.push(depName)
        await fs.copy(localDependencyPaths.get(depName), `${pasteLocation}/${nameNoSlash(depName)}`);

        ////// RECURSE

        await bringIn(`${pasteLocation}/${nameNoSlash(depName)}`, rootPackageDir, rootPackageJson, recursionDepth + 1, pasteLocation, alreadyCopied)
    }

    return localDependencies
}


/////////
// HELPER FUNCTIONS 
///////
function getRootPackageName(packageJson) {

    const slashIndex = packageJson.name.indexOf("/")

    if (packageJson.name[0] !== "@" || slashIndex === -1) {

        throw Error('Package name does not follow npm workspace monorepo naming convention \nPackage name must be formatted as @rootname/subname')
    }

    const rootPackageName = packageJson.name.substring(1, slashIndex)

    return rootPackageName
}

async function findRootPackagePath(packageDirectory, rootPackageName) {

    const maxDepthSearch = 6;

    for (let i = 1; i < maxDepthSearch; i++) {
        const directory = packageDirectory + "/..".repeat(i) + "/package.json"
        try {
            const packJson = parse(await fs.readFile(directory))

            if (packJson.name === rootPackageName) {
                return path.resolve(directory)
            }
        }
        catch {
            continue
        }
    }
}

/**
 * 
 * @param {*} packageDirectory directory we want to get local dependecnies from
 * @param {*} rootPackageName name of the monorepos root name (without @)
 * @returns 
 */
async function getLocalDependencies(packageDirectory, rootPackageName) {

    const packageJsonPath = `${packageDirectory}/package.json`;
    const packageJson = parse(await fs.readFile(packageJsonPath));

    const localDependencies = new Map()

    const rootNameSubStr = "@" + rootPackageName
    const rootNameSubLen = rootNameSubStr.length

    for (var depName in packageJson.dependencies) {
        const version = packageJson.dependencies[depName]

        if (depName.substring(0, rootNameSubLen) === rootNameSubStr) {
            localDependencies.set(depName, version)
        }
    }

    return localDependencies
}

async function findLocalDependencyPaths(localDependencyNames, rootDir, workspaces) {

    const localDependencyPaths = new Map()

    const workspacePaths = workspaces.map(ws => path.resolve(rootDir, ws))

    for (var depName of localDependencyNames) {

        let dependencyDir = ""

        for (var workspacePath of workspacePaths) {

            const packageJsonPath = workspacePath + "/package.json"
            try {
                const packJson = parse(await fs.readFile(packageJsonPath))

                if (packJson.name === depName) {
                    dependencyDir = workspacePath
                    break
                }
            }
            catch {
                continue
            }
        }

        if (!dependencyDir) {
            throw Error(`Could Not Find Directory of ${depName}`)
        }

        localDependencyPaths.set(depName, dependencyDir)
    }

    return localDependencyPaths
}


/**
 * 
 * @param {*} packageDirectory 
 * @param {*} packageJson 
 * @param {*} dependencyNames 
 * @param {*} intarget if in the targets package.json location of package will be './local-package', else will be  '../'
 */
async function rewritePackageJson(packageDirectory, packageJson, dependencyNames, intarget = false) {

    for (var depName of dependencyNames) {
        packageJson.dependencies[depName] = intarget ? `file:./local-packages/${nameNoSlash(depName)}` : `file:../${nameNoSlash(depName)}`
    }
    // Re-Write the package.json
    await fs.writeFile(packageDirectory + "/package.json", JSON.stringify(packageJson, null, 2));
}



function nameNoSlash(name) {
    const parts = name.split("/")
    return [parts[parts.length - 1]]
}