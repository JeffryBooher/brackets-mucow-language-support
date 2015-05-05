/*
 * Copyright (c) 2015 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, brackets, window, $, Mustache, navigator */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var AppInit                     = brackets.getModule("utils/AppInit"),
        PreferencesManager          = brackets.getModule("preferences/PreferencesManager"),
        ExtensionUtils              = brackets.getModule("utils/ExtensionUtils"),
        LanguageManager             = brackets.getModule("language/LanguageManager"),
        XMLUtils                    = brackets.getModule("language/XMLUtils"),
        TokenUtils                  = brackets.getModule("utils/TokenUtils"),
        CodeHintManager             = brackets.getModule("editor/CodeHintManager"),
        MucowTags                   = require("text!MucowTags.json"),
        MucowAttributes             = require("text!MucowAttributes.json"),
        cachedAttributes            = {},
        tags,
        attributes;


    // TODO: This may improve matching heuristics
    var stringMatcherOptions = {
        preferPrefixMatches: true
    };
    
    // Regex to find whitespace.
    var regexWhitespace = /^\s+$/;

    // Add Language support for mucow
    LanguageManager.defineLanguage("mucow", {
        name: "MUSE Widget Definition",
        mode: "xml",
        fileExtensions: ["mucow"]
    });
    
    
    // Add Codehints
    

    /**
     * @constructor
     */
    function TagHints() {
        this.exclusion = null;
    }
    
    /**
     * Check whether the exclusion is still the same as text after the cursor. 
     * If not, reset it to null.
     */
    TagHints.prototype.updateExclusion = function () {
        var textAfterCursor;
        if (this.exclusion && this.tagInfo) {
            textAfterCursor = this.tagInfo.tagName.substr(this.tagInfo.offset);
            if (!CodeHintManager.hasValidExclusion(this.exclusion, textAfterCursor)) {
                this.exclusion = null;
            }
        }
    };
    
    /**
     * Determines whether tag hints are available in the current editor
     * context.
     * 
     * @param {Editor} editor 
     * A non-null editor object for the active window.
     *
     * @param {string} implicitChar 
     * Either null, if the hinting request was explicit, or a single character
     * that represents the last insertion and that indicates an implicit
     * hinting request.
     *
     * @return {boolean} 
     * Determines whether the current provider is able to provide hints for
     * the given editor context and, in case implicitChar is non- null,
     * whether it is appropriate to do so.
     */
    TagHints.prototype.hasHints = function (editor, implicitChar) {
        if (editor.getModeForSelection() === "xml") {
            this.editor = editor;
            this.tagInfo = XMLUtils.getTagInfo(this.editor, this.editor.getCursorPos());
            
            return (this.tagInfo && this.tagInfo.tokenType === XMLUtils.TOKEN_TAG);
        }
        return false;
    };
       
    /**
     * Returns a list of availble tag hints if possible for the current
     * editor context. 
     *
     * @return {jQuery.Deferred|{
     *              hints: Array.<string|jQueryObject>,
     *              match: string,
     *              selectInitial: boolean,
     *              handleWideResults: boolean}}
     * Null if the provider wishes to end the hinting session. Otherwise, a
     * response object that provides:
     * 1. a sorted array hints that consists of strings
     * 2. a string match that is used by the manager to emphasize matching
     *    substrings when rendering the hint list
     * 3. a boolean that indicates whether the first result, if one exists,
     *    should be selected by default in the hint list window.
     * 4. handleWideResults, a boolean (or undefined) that indicates whether
     *    to allow result string to stretch width of display.
     */
    TagHints.prototype.getHints = function (implicitChar) {
        var query,
            result;

        this.tagInfo = XMLUtils.getTagInfo(this.editor, this.editor.getCursorPos());
        if (this.tagInfo.tokenType === XMLUtils.TOKEN_TAG) {
            if (this.tagInfo.offset >= 0) {
                this.updateExclusion();
                query = this.tagInfo.token.string.trim();
                query = query.replace('<', ''); // remove the leading <
                result = $.map(tags, function (value, key) {
                    if (key.indexOf(query) === 0) {
                        return key;
                    }
                }).sort();
                
                return {
                    hints: result,
                    match: query,
                    selectInitial: true,
                    handleWideResults: false
                };
            }
        }
        
        return null;
    };
    
    /**
     * Inserts a given tag hint into the current editor context. 
     * 
     * @param {string} hint 
     * The hint to be inserted into the editor context.
     *
     * @return {boolean} 
     * Indicates whether the manager should follow hint insertion with an
     * additional explicit hint request.
     */
    TagHints.prototype.insertHint = function (completion) {
        var start = {line: -1, ch: -1},
            end = {line: -1, ch: -1},
            cursor = this.editor.getCursorPos(),
            charCount = 0;

        if (this.tagInfo.tokenType === XMLUtils.TOKEN_TAG) {
            var textAfterCursor = this.tagInfo.token.string.substr(this.tagInfo.offset);
            if (CodeHintManager.hasValidExclusion(this.exclusion, textAfterCursor)) {
                charCount = this.tagInfo.offset;
            } else {
                charCount = this.tagInfo.token.string.length;
            }
        }

        end.line = start.line = cursor.line;
        start.ch = cursor.ch - this.tagInfo.offset;
        end.ch = start.ch + charCount;

        if (this.exclusion || completion !== this.tagInfo.token.string) {
            if (start.ch !== end.ch) {
                this.editor.document.replaceRange(completion, start, end);
            } else {
                this.editor.document.replaceRange(completion, start);
            }
            this.exclusion = null;
        }
        
        return false;
    };

    /**
     * @constructor
     */
    function AttrHints() {
        this.globalAttributes = this.readGlobalAttrHints();
        this.cachedHints = null;
        this.exclusion = "";
    }

    /**
     * @private
     * Parse the code hints from JSON data and extract all hints from property names.
     * @return {!Array.<string>} An array of code hints read from the JSON data source.
     */
    AttrHints.prototype.readGlobalAttrHints = function () {
        return $.map(attributes, function (value, key) {
            if (value.global === "true") {
                return key;
            }
        });
    };

    /**
     * Helper function that determines the possible value hints for a given tag/attribute name pair
     * 
     * @param {{queryStr: string}} query
     * The current query
     *
     * @param {string} tagName 
     * tag name
     *
     * @param {string} attrName 
     * attribute name
     *
     * @return {{hints: Array.<string>|$.Deferred, sortFunc: ?Function}} 
     * The (possibly deferred) hints and the sort function to use on thise hints.
     */
    AttrHints.prototype._getValueHintsForAttr = function (query, tagName, attrName) {
        // We look up attribute values with tagName plus a slash and attrName first.  
        // If the lookup fails, then we fall back to look up with attrName only. Most 
        // of the attributes in JSON are using attribute name only as their properties, 
        // but in some cases like "type" attribute, we have different properties like 
        // "script/type", "link/type" and "button/type".
        var hints = [],
            sortFunc = null;
        
        var tagPlusAttr = tagName + "/" + attrName,
            attrInfo = attributes[tagPlusAttr] || attributes[attrName];
        
        if (attrInfo) {
            if (attrInfo.type === "boolean") {
                hints = ["false", "true"];
            } else if (attrInfo.attribOption) {
                hints = attrInfo.attribOption;
            }
        }
        
        return { hints: hints, sortFunc: sortFunc };
    };
    
    /**
     * Check whether the exclusion is still the same as text after the cursor. 
     * If not, reset it to null.
     *
     * @param {boolean} attrNameOnly
     * true to indicate that we update the exclusion only if the cursor is inside an attribute name context.
     * Otherwise, we also update exclusion for attribute value context.
     */
    AttrHints.prototype.updateExclusion = function (attrNameOnly) {
        if (this.exclusion && this.tagInfo) {
            var tokenType = this.tagInfo.tokenType,
                offset = this.tagInfo.offset,
                textAfterCursor;
            
            if (tokenType === XMLUtils.TOKEN_VALUE) {
                textAfterCursor = this.tagInfo.attrName.substr(offset);
            } else if (!attrNameOnly && tokenType === XMLUtils.TOKEN_ATTR) {
                textAfterCursor = this.tagInfo.attrName.substr(offset);
            }
            if (!CodeHintManager.hasValidExclusion(this.exclusion, textAfterCursor)) {
                this.exclusion = null;
            }
        }
    };
    
    /**
     * Determines whether attribute hints are available in the current 
     * editor context.
     * 
     * @param {Editor} editor 
     * A non-null editor object for the active window.
     *
     * @param {string} implicitChar 
     * Either null, if the hinting request was explicit, or a single character
     * that represents the last insertion and that indicates an implicit
     * hinting request.
     *
     * @return {boolean} 
     * Determines whether the current provider is able to provide hints for
     * the given editor context and, in case implicitChar is non-null,
     * whether it is appropriate to do so.
     */
    AttrHints.prototype.hasHints = function (editor, implicitChar) {
        if (editor.getModeForSelection() === "xml") {
            this.editor = editor;
            this.tagInfo = XMLUtils.getTagInfo(this.editor, this.editor.getCursorPos());
            
            return (this.tagInfo && this.tagInfo.tokenType !== XMLUtils.TOKEN_TAG);
        }
        return false;
    };
    
    AttrHints.prototype._getTagAttributes = function (editor, constPos) {
        var pos, ctx, ctxPrev, ctxNext, ctxTemp, tagName, exclusionList = [], shouldReplace;

        pos = $.extend({}, constPos);
        ctx = TokenUtils.getInitialContext(editor._codeMirror, pos);

        // Stop if the cursor is before = or an attribute value.
        ctxTemp = $.extend(true, {}, ctx);
        if (ctxTemp.token.type === null && regexWhitespace.test(ctxTemp.token.string)) {
            if (TokenUtils.moveSkippingWhitespace(TokenUtils.moveNextToken, ctxTemp)) {
                if ((ctxTemp.token.type === null && ctxTemp.token.string === "=") ||
                        ctxTemp.token.type === "string") {
                    return null;
                }
                TokenUtils.moveSkippingWhitespace(TokenUtils.movePrevToken, ctxTemp);
            }
        }

        // Incase an attribute is followed by an equal sign, shouldReplace will be used
        // to prevent from appending ="" again.
        if (ctxTemp.token.type === "attribute") {
            if (TokenUtils.moveSkippingWhitespace(TokenUtils.moveNextToken, ctxTemp)) {
                if (ctxTemp.token.type === null && ctxTemp.token.string === "=") {
                    shouldReplace = true;
                }
            }
        }

        // Look-Back and get the attributes and tag name.
        pos = $.extend({}, constPos);
        ctxPrev = TokenUtils.getInitialContext(editor._codeMirror, pos);
        while (TokenUtils.movePrevToken(ctxPrev)) {
            if (ctxPrev.token.type && ctxPrev.token.type.indexOf("tag bracket") >= 0) {
                // Disallow hints in closed tag and inside tag content
                if (ctxPrev.token.string === "</" || ctxPrev.token.string.indexOf(">") !== -1) {
                    return null;
                }
            }

            // Get attributes.
            if (ctxPrev.token.type === "attribute") {
                exclusionList.push(ctxPrev.token.string);
            }

            // Get tag.
            if (ctxPrev.token.type === "tag") {
                tagName = ctxPrev.token.string;
                if (TokenUtils.movePrevToken(ctxPrev)) {
                    if (ctxPrev.token.type === "tag bracket" && ctxPrev.token.string === "<") {
                        break;
                    }
                    return null;
                }
            }
        }

        // Look-Ahead and find rest of the attributes.
        pos = $.extend({}, constPos);
        ctxNext = TokenUtils.getInitialContext(editor._codeMirror, pos);
        while (TokenUtils.moveNextToken(ctxNext)) {
            if (ctxNext.token.type === "string" && ctxNext.token.string === "\"") {
                return null;
            }

            // Stop on closing bracket of its own tag or opening bracket of next tag.
            if (ctxNext.token.type === "tag bracket" &&
                    (ctxNext.token.string.indexOf(">") >= 0 || ctxNext.token.string === "<")) {
                break;
            }
            if (ctxNext.token.type === "attribute" && exclusionList.indexOf(ctxNext.token.string) === -1) {
                exclusionList.push(ctxNext.token.string);
            }
        }
        return {
            tagName: tagName,
            exclusionList: exclusionList,
            shouldReplace: shouldReplace
        };
    };
    
    /**
     * Returns a list of availble attribute hints if possible for the 
     * current editor context. 
     *
     * @return {jQuery.Deferred|{
     *              hints: Array.<string|jQueryObject>,
     *              match: string,
     *              selectInitial: boolean,
     *              handleWideResults: boolean}}
     * Null if the provider wishes to end the hinting session. Otherwise, a
     * response object that provides:
     * 1. a sorted array hints that consists of strings
     * 2. a string match that is used by the manager to emphasize matching
     *    substrings when rendering the hint list
     * 3. a boolean that indicates whether the first result, if one exists,
     *    should be selected by default in the hint list window.
     * 4. handleWideResults, a boolean (or undefined) that indicates whether
     *    to allow result string to stretch width of display.
     */
    AttrHints.prototype.getHints = function (implicitChar) {
        var cursor = this.editor.getCursorPos(),
            query = {queryStr: null},
            tokenType,
            offset,
            result = [];
 
        this.tagInfo = XMLUtils.getTagInfo(this.editor, cursor);
        
        tokenType = this.tagInfo.tokenType;
        offset = this.tagInfo.offset;

        if (tokenType === XMLUtils.TOKEN_VALUE || tokenType === XMLUtils.TOKEN_ATTR) {
            query.tag = this.tagInfo.tagName;
            query.attrName = this.tagInfo.attrName;
            query.usedAttr = this._getTagAttributes(this.editor, cursor);
            query.queryStr = this.tagInfo.token.string.trim();
            if (tokenType === XMLUtils.TOKEN_VALUE) {
                query.queryStr = query.queryStr.replace(/^\"|$\"/g, "");
            }
        }

        if (query.tag && query.queryStr !== null) {
            var tagName = query.tag,
                attrName = query.attrName,
                filter = query.queryStr,
                unfiltered = [],
                hints = [],
                sortFunc = null;

            if (attrName) {
                var hintsAndSortFunc = this._getValueHintsForAttr(query, tagName, attrName);
                hints = hintsAndSortFunc.hints;
                sortFunc = hintsAndSortFunc.sortFunc;
                
            } else if (tags && tags[tagName] && tags[tagName].attributes) {
                unfiltered = tags[tagName].attributes.concat(this.globalAttributes);
                hints = $.grep(unfiltered, function (attr, i) {
                    return query.usedAttr.exclusionList.indexOf(attr) < 0;
                });
            }
            
            if (hints instanceof Array && hints.length) {
                console.assert(!result.length);
                result = $.map(hints, function (item) {
                    if (item.indexOf(filter) === 0) {
                        return item;
                    }
                }).sort(sortFunc);
                return {
                    hints: result,
                    match: query.queryStr,
                    selectInitial: true,
                    handleWideResults: false
                };
            } else if (hints instanceof Object && hints.hasOwnProperty("done")) { // Deferred hints
                var deferred = $.Deferred();
                hints.done(function (asyncHints) {
                    deferred.resolveWith(this, [{
                        hints: asyncHints,
                        match: query.queryStr,
                        selectInitial: true,
                        handleWideResults: false
                    }]);
                });
                return deferred;
            } else {
                return null;
            }
        }

        
    };
    
    /**
     * Inserts a given attribute hint into the current editor context.
     * 
     * @param {string} hint 
     * The hint to be inserted into the editor context.
     * 
     * @return {boolean} 
     * Indicates whether the manager should follow hint insertion with an
     * additional explicit hint request.
     */
    AttrHints.prototype.insertHint = function (completion) {
        var cursor = this.editor.getCursorPos(),
            start = {line: -1, ch: -1},
            end = {line: -1, ch: -1},
            tokenType = this.tagInfo.tokenType,
            offset = this.tagInfo.offset,
            charCount = 0,
            insertedName = false,
            replaceExistingOne = this.tagInfo.attrName,
            endQuote = "",
            shouldReplace = true,
            textAfterCursor;

        if (tokenType === XMLUtils.TOKEN_VALUE) {
            textAfterCursor = this.tagInfo.token.string.substr(offset);
            if (CodeHintManager.hasValidExclusion(this.exclusion, textAfterCursor)) {
                charCount = offset;
                replaceExistingOne = false;
            } else {
                charCount = this.tagInfo.token.string.length;
            }
            // Append an equal sign and two double quotes if the current attr is not an empty attr
            // and then adjust cursor location before the last quote that we just inserted.
            if (completion === this.tagInfo.token.string) {
                shouldReplace = false;
            } else {
                var startChar = this.editor.document.getLine(cursor.line).substr(cursor.ch - offset, 1);
                if (startChar === "\"") {
                    completion += "\"";
                }
                charCount = this.tagInfo.token.string.length;
                if (this.tagInfo.token.string.trim().length > 0) {
                    offset = this.tagInfo.token.string.length;
                } else {
                    offset = 0;
                }
            }
        } else if (tokenType === XMLUtils.TOKEN_ATTR) {
            textAfterCursor = this.tagInfo.attrName.substr(offset);
            if (CodeHintManager.hasValidExclusion(this.exclusion, textAfterCursor)) {
                charCount = offset;
                // Set exclusion to null only after attribute value insertion,
                // not after attribute name insertion since we need to keep it 
                // for attribute value insertion.
                this.exclusion = null;
            } else if (replaceExistingOne) {
                charCount = this.tagInfo.attrName.length;
            } else {
                this.tagInfo.token.string = this.tagInfo.token.string.trim();
                charCount = this.tagInfo.token.string.length;
                if (charCount > 0) {
                    offset = this.tagInfo.token.string.length;
                } else {
                    offset = 0;
                }
                if (!attributes[completion] || attributes[completion].type !== "flag") {
                    completion += "=\"\"";
                    insertedName = true;
                }
            }
            
            if (completion === this.tagInfo.attrName) {
                shouldReplace = false;
            }
        }

        end.line = start.line = cursor.line;
        start.ch = cursor.ch - offset;
        end.ch = start.ch + charCount;

        if (shouldReplace) {
            if (start.ch !== end.ch) {
                this.editor.document.replaceRange(completion, start, end);
            } else {
                this.editor.document.replaceRange(completion, start);
            }
        }

        if (insertedName) {
            this.editor.setCursorPos(start.line, start.ch + completion.length - 1);

            // Since we're now inside the double-quotes we just inserted,
            // immediately pop up the attribute value hint.
            return true;
        }
        
        return false;
    };

    AppInit.appReady(function () {
        // Parse JSON files
        tags = JSON.parse(MucowTags);
        attributes = JSON.parse(MucowAttributes);
        
        // Register code hint providers
        var tagHints = new TagHints();
        var attrHints = new AttrHints();
        CodeHintManager.registerHintProvider(tagHints, ["mucow"], 0);
        CodeHintManager.registerHintProvider(attrHints, ["mucow"], 0);
    
        // For unit testing
        exports.tagHintProvider = tagHints;
        exports.attrHintProvider = attrHints;
    });

});
