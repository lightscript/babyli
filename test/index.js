import path from "path";
import { runFixtureTests, runTestsWithLightScript } from "./utils/runFixtureTests";
import { parse, parseExpression } from "../lib";

runFixtureTests(path.join(__dirname, "fixtures"), parse);
runTestsWithLightScript(path.join(__dirname, "fixtures"), parse);
runFixtureTests(path.join(__dirname, "expressions"), parseExpression);
