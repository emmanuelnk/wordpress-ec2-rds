import * as utils from "./utils"
// @ponicode
describe("utils.replaceAllSubstrings", () => {
    test("0", () => {
        let callFunction: any = () => {
            utils.replaceAllSubstrings(["consectetur blanditiis rerum"], "foo bar")
        }
    
        expect(callFunction).not.toThrow()
    })

    test("1", () => {
        let callFunction: any = () => {
            utils.replaceAllSubstrings(["perferendis aut voluptatibus", "perferendis aut voluptatibus", "in et tempore", "illo qui omnis", "illo qui omnis"], "foo bar")
        }
    
        expect(callFunction).not.toThrow()
    })

    test("2", () => {
        let callFunction: any = () => {
            utils.replaceAllSubstrings(["in et tempore"], "Hello, world!")
        }
    
        expect(callFunction).not.toThrow()
    })

    test("3", () => {
        let callFunction: any = () => {
            utils.replaceAllSubstrings(["perferendis aut voluptatibus", "perferendis aut voluptatibus", "illo qui omnis", "illo qui omnis", "in et tempore"], "This is a Text")
        }
    
        expect(callFunction).not.toThrow()
    })

    test("4", () => {
        let callFunction: any = () => {
            utils.replaceAllSubstrings(["perferendis aut voluptatibus", "perferendis aut voluptatibus"], "This is a Text")
        }
    
        expect(callFunction).not.toThrow()
    })

    test("5", () => {
        let callFunction: any = () => {
            utils.replaceAllSubstrings([], "")
        }
    
        expect(callFunction).not.toThrow()
    })
})
