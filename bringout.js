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


////SET UP AND GO
go()
async function go() {

    const [...args] = process.argv

    const packageJsonPath =  `${process.cwd()}/package.json`;
    const packageJson = parse(await fs.readFile(packageJsonPath));

    const localDependenciesJsonPath =  `${process.cwd()}/local-dependency-map.json`;
    const localDependenciesJson = parse(await fs.readFile(localDependenciesJsonPath));

    await rewritePackageJson(process.cwd(), packageJson, localDependenciesJson)

    await fs.remove(`${process.cwd()}/local-packages`);

    await fs.remove(`${process.cwd()}/local-dependency-map.json`);
}


async function rewritePackageJson(packageDirectory, packageJson, localDependencies){

    for (var depName of [...localDependencies.keys()]){
        const version = localDependencies.get(depName)
        packageJson.dependencies[depName] = version
    }
    // Re-Write the package.json
    await fs.writeFile(packageDirectory+"/package.json", JSON.stringify(packageJson, null, 2));
}


