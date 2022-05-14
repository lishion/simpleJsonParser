type SingleValue = string|number|boolean|null
type JsonObject = {[key: string]:SingleValue|(JsonObject|SingleValue)[]}
type JsonValue = JsonObject|SingleValue|(JsonObject|SingleValue)[]

interface Parser{
    parse(): JsonObject;
}

class JsonParseException{
    position: number;
    exceptionChar: string;
    shouldBe: boolean;
    constructor(position: number, exceptionChar: string, shouldBe: boolean=true){
        this.position = position;
        this.exceptionChar = exceptionChar;
        this.shouldBe = shouldBe;
    }

    getExcepted(): string{
        if(this.shouldBe){
            return `should be '${this.exceptionChar}' here`
        }else{
            return `should not be '${this.exceptionChar}' here`
        }
    }
}


class SimpleParser implements Parser{
    
    static NUMBER_RE = new RegExp("^(0|([1-9][0-9]*(\.[0-9][0-9]*)?))([eE](0|[1-9][0-9]*))?");
    static EMPTY_STRING = new Set([" ", "\n", "\r", "\t"])
    
    index: number;
    json: string;

    constructor(json: string){
        this.index = 0;
        this.json = json;
    }

    formatException(e: JsonParseException, contextLength: number=100): string{
        const contextStartPosition = Math.max(e.position - contextLength, 0);
        const parseContext = this.json.slice(contextStartPosition, e.position + 1)
        const lastLine = parseContext.split('\n').pop();
        const lastLineStartPosition = contextStartPosition + (parseContext.length - lastLine.length)
        const prompt = Array.from(Array(e.position - lastLineStartPosition + 1).keys())
                                    .map((_, index, array) => (index < (array.length - 1) ? '-': '^'))
                                    .join('')
                                    .concat(' ' + e.getExcepted());
        return `${parseContext}\n${prompt}`
    }

    parse(): JsonObject {
        try{
            const jsonObj = this.peekObject();
            this.skipEmpty();
            if(!this.reachEOF()){
                this.raiseException('EOF');
            }
            return jsonObj;
        }catch(e){
            if(e instanceof JsonParseException){
                throw Error(`\njson syntax error\n${this.formatException(e)}`)
            }else{
                throw e;
            }
        }
    }
    
    private goToNextChar(){
        this.index += 1;
    }

    private getFirstChar(): string{
        return this.json[this.index];
    }

    private getRestChars(): string{
        return this.json.slice(this.index);
    }

    private reachEOF(): boolean{
        return this.index === this.json.length;
    }

    private raiseException(exceptionChar: string, shouldBe: boolean=true){
        throw new JsonParseException(this.index, exceptionChar, shouldBe);
    }

    private equalOrRise(chr: string){
        if(this.getFirstChar() === chr){
            this.goToNextChar();
        }else{
            this.raiseException(chr);
        }
    }

    private checkAndSkipLiterate(literal: string){
        for(const s of literal){
            this.equalOrRise(s)
        }
    }

    private skipInvisiableChars(){
        while(SimpleParser.EMPTY_STRING.has(this.json[this.index])){
            this.goToNextChar();
        }
    }

    private skipEmpty(){
        while(true){
            this.skipInvisiableChars();
            if(this.getRestChars().startsWith("//")){
                do{
                    this.goToNextChar();
                }while(this.getFirstChar() !== '\n' && !this.reachEOF())
            }else{
                break;
            }
        }
    }

    private checkAndSkipColon(){
        this.skipEmpty();
        this.checkAndSkipLiterate(':');
        this.skipEmpty();
    }

    private chekAndSkipComma(){
        this.checkAndSkipLiterate(',');
    }

    private isHex(chr: string){
        const lowerChar = chr.toLocaleLowerCase();
        return ('0' <= lowerChar && lowerChar <= '9') || ('a' <= lowerChar && lowerChar <= 'f')
    }

    private peekString(): string{
        this.checkAndSkipLiterate('"');
        const chars: string[] = []; 
        while(true){
            if (this.reachEOF()){
                this.raiseException('EOF', false);
            }
            let chr: string = this.getFirstChar();
            if(chr === '"'){
                this.goToNextChar();
                break;
            }
            if(chr === '\\'){
                this.goToNextChar();
                const nextChar = this.getFirstChar();
                switch(nextChar){
                    case '"': chr = '"'; break;
                    case '\\': chr = '\\'; break;
                    case 'b': chr = '\b'; break;
                    case 'f': chr = '\f'; break;
                    case 'n': chr = '\n'; break;
                    case 'r': chr = '\r'; break;
                    case 't': chr = '\t'; break;
                    case 'u': 
                        let unicodeControlChars = "";
                        let validUnicodeChars = true;
                        for(let i = 0; i < 4; i++){
                            this.goToNextChar();
                            let maybeNumber = this.getFirstChar();
                            unicodeControlChars += maybeNumber;
                            if(!this.isHex(maybeNumber)){
                                validUnicodeChars = false;
                            }
                        }
                        if(!validUnicodeChars){
                            throw Error(`invaliad uniconde char \\u${unicodeControlChars}`)
                        }
                        chr = String.fromCharCode(Number.parseInt(`0x${unicodeControlChars}`));
                        break;
                    default:
                        throw Error(`invaliad control char \\${nextChar}`)
                } 
            }
            this.goToNextChar();
            chars.push(chr);
        }
        return chars.join("");
    }

    private peekNumber(): number{
        let symbol = 1;
        if(this.json[this.index] === '-'){
            this.index += 1;
            symbol = -1;
        }
        const [allMatch] = SimpleParser.NUMBER_RE.exec(this.getRestChars())
        if(!allMatch){
            this.raiseException('0-9');
        }
        this.index += allMatch.length
        return symbol * Number.parseFloat(allMatch);
    }    



    private peekValue(): JsonValue{
        if(this.getFirstChar() === '"'){
            return this.peekString();
        }else if(this.getFirstChar() === "{"){
            return this.peekObject()
        }else if(this.getFirstChar() === '['){
            return this.peekArray();
        }else if(this.getFirstChar() >= '0' && this.getFirstChar() <= '9'){
            return this.peekNumber();
        }else if(this.getFirstChar() === 't'){
            this.checkAndSkipLiterate('true');
            return true;
        }else if(this.getFirstChar() === 'f'){
            this.checkAndSkipLiterate('false');
            return false;
        }else if(this.getFirstChar() === "n"){
            this.checkAndSkipLiterate("null");
            return null;
        }
        this.raiseException('json value')
    }

    private peekArray(): JsonValue{
        this.checkAndSkipLiterate("[");
        let values = []
        while(true){
            this.skipEmpty();
            values.push(this.peekValue())
            this.skipEmpty();
            if(this.getFirstChar() === ']'){
                this.goToNextChar();
                break;
            }
            this.chekAndSkipComma();
        }
        return values;
    }

    private peekObject(): JsonObject{
        this.checkAndSkipLiterate("{");
        const jsonObject = {}
        while(true){
            this.skipEmpty();
            const key = this.peekString();
            this.checkAndSkipColon();
            const value = this.peekValue();
            jsonObject[key] = value;
            this.skipEmpty();
            if(this.getFirstChar() === "}"){
                this.goToNextChar();
                break;
            }
            this.chekAndSkipComma();
        }
        return jsonObject;
    }
}

function parse(json: string): JsonObject{
    return new SimpleParser(json).parse();
}

const json = `{
    "name": "lily",
    "age": 123, 
    "sex": null, // this is a comment

    // this is another comment
    "country": "\\u4e2d国",
    "arg1": true,
    "arg2": false  ,
    "arg3": [1, "2", true, {"a": 1}   ],
    "address": {
        "email": "testtest",
        "phone": [123456, "aaa", [1, "sadfaf", {"1": 123.0e3}], {"a": "b"}]
    }
}
`
console.log(parse(json))

// console.log(JSON.stringify(parse(json), null))
// const re = new RegExp("^(0|([1-9][0-9]*(\.[0-9][0-9]*)?))([eE](0|[1-9][0-9]*))?")
//const re = new RegExp("0|([1-9][0-9]*)")
// console.info(re.exec("1111e123")[0])
// console.info(re.exec("0111")[0])
// console.info(re.exec("1")[0])
// console.info(re.exec("1.23")[0])
// console.info(re.exec("123.0e3")[0])