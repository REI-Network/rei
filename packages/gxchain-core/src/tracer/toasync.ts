import * as recast from 'recast';
import { namedTypes } from 'ast-types';

export function toAsync(code: string) {
  return recast.print(convert(recast.parse(code))).code;
}

function convertArray<T>(array: T[] | undefined) {
  if (array !== undefined) {
    for (const i in array) {
      array[i] = convert(array[i]);
    }
  }
}

// TODO: impl convert all types.
function convert(unknowVal: any): any {
  if (unknowVal === undefined || unknowVal === null) {
    return unknowVal;
  }
  if (unknowVal.type === undefined) {
    return unknowVal;
  }
  switch (unknowVal.type) {
    case 'File': {
      const v = unknowVal as namedTypes.File;
      v.program = convert(v.program);
      return v;
    }
    case 'Program': {
      const v = unknowVal as namedTypes.Program;
      convertArray(v.body);
      return v;
    }
    case 'Identifier': {
      const v = unknowVal as namedTypes.Identifier;
      // TODO
      return v;
    }
    case 'BlockStatement': {
      const v = unknowVal as namedTypes.BlockStatement;
      convertArray(v.body);
      return v;
    }
    case 'EmptyStatement': {
      const v = unknowVal as namedTypes.EmptyStatement;
      // TODO
      return v;
    }
    case 'ExpressionStatement': {
      const v = unknowVal as namedTypes.ExpressionStatement;
      v.expression = convert(v.expression);
      return v;
    }
    case 'IfStatement': {
      const v = unknowVal as namedTypes.IfStatement;
      v.consequent = convert(v.consequent);
      v.alternate = convert(v.alternate);
      v.test = convert(v.test);
      return v;
    }
    case 'LabeledStatement': {
      const v = unknowVal as namedTypes.LabeledStatement;
      v.body = convert(v.body);
      v.label = convert(v.label);
      return v;
    }
    case 'BreakStatement': {
      const v = unknowVal as namedTypes.BreakStatement;
      v.label = convert(v.label);
      return v;
    }
    case 'ContinueStatement': {
      const v = unknowVal as namedTypes.ContinueStatement;
      v.label = convert(v.label);
      return v;
    }
    case 'WithStatement': {
      const v = unknowVal as namedTypes.WithStatement;
      v.body = convert(v.body);
      v.object = convert(v.object);
      return v;
    }
    case 'SwitchStatement': {
      const v = unknowVal as namedTypes.SwitchStatement;
      v.discriminant = convert(v.discriminant);
      convertArray(v.cases);
      return v;
    }
    case 'SwitchCase': {
      const v = unknowVal as namedTypes.SwitchCase;
      convertArray(v.consequent);
      v.test = convert(v.test);
      return v;
    }
    case 'ReturnStatement': {
      const v = unknowVal as namedTypes.ReturnStatement;
      v.argument = convert(v.argument);
      return v;
    }
    case 'ThrowStatement': {
      const v = unknowVal as namedTypes.ThrowStatement;
      v.argument = convert(v.argument);
      return v;
    }
    case 'TryStatement': {
      const v = unknowVal as namedTypes.TryStatement;
      v.block = convert(v.block);
      v.finalizer = convert(v.finalizer);
      convertArray(v.guardedHandlers);
      v.handler = convert(v.handler);
      convertArray(v.handlers);
      return v;
    }
    case 'CatchClause': {
      const v = unknowVal as namedTypes.CatchClause;
      v.body = convert(v.body);
      v.guard = convert(v.guard);
      v.param = convert(v.param);
      return v;
    }
    case 'WhileStatement': {
      const v = unknowVal as namedTypes.WhileStatement;
      v.body = convert(v.body);
      v.test = convert(v.test);
      return v;
    }
    case 'DoWhileStatement': {
      const v = unknowVal as namedTypes.DoWhileStatement;
      v.body = convert(v.body);
      v.test = convert(v.test);
      return v;
    }
    case 'ForStatement': {
      const v = unknowVal as namedTypes.ForStatement;
      v.body = convert(v.body);
      v.init = convert(v.init);
      v.test = convert(v.test);
      v.update = convert(v.update);
      return v;
    }
    case 'VariableDeclaration': {
      const v = unknowVal as namedTypes.VariableDeclaration;
      for (const i in v.declarations) {
        v.declarations[i] = convert(v.declarations[i]);
      }
      return v;
    }
    case 'ForInStatement': {
      const v = unknowVal as namedTypes.ForInStatement;
      v.body = convert(v.body);
      v.right = convert(v.right);
      return v;
    }
    case 'DebuggerStatement': {
      const v = unknowVal as namedTypes.DebuggerStatement;
      // TODO
      return v;
    }
    case 'FunctionDeclaration': {
      const v = unknowVal as namedTypes.FunctionDeclaration;
      v.async = true;
      v.body = convert(v.body);
      for (const i in v.params) {
        v.params[i] = convert(v.params[i]);
      }
      return v;
    }
    case 'FunctionExpression': {
      const v = unknowVal as namedTypes.FunctionExpression;
      v.async = true;
      v.body = convert(v.body);
      return v;
    }
    case 'VariableDeclarator': {
      const v = unknowVal as namedTypes.VariableDeclarator;
      v.init = convert(v.init);
      return v;
    }
    case 'ThisExpression': {
      const v = unknowVal as namedTypes.ThisExpression;
      return v;
    }
    case 'ArrayExpression': {
      const v = unknowVal as namedTypes.ArrayExpression;
      convertArray(v.elements);
      return v;
    }
    case 'ObjectExpression': {
      const v = unknowVal as namedTypes.ObjectExpression;
      convertArray(v.properties);
      return v;
    }
    case 'Property': {
      const v = unknowVal as namedTypes.Property;
      v.value = convert(v.value);
      return v;
    }
    case 'Literal': {
      const v = unknowVal as namedTypes.Literal;
      v.value = convert(v.value);
      return v;
    }
    case 'SequenceExpression': {
      const v = unknowVal as namedTypes.SequenceExpression;
      convertArray(v.expressions);
      return v;
    }
    case 'UnaryExpression': {
      const v = unknowVal as namedTypes.UnaryExpression;
      v.argument = convert(v.argument);
      return v;
    }
    case 'BinaryExpression': {
      const v = unknowVal as namedTypes.BinaryExpression;
      v.left = convert(v.left);
      v.right = convert(v.right);
      return v;
    }
    case 'AssignmentExpression': {
      const v = unknowVal as namedTypes.AssignmentExpression;
      v.left = convert(v.left);
      v.right = convert(v.right);
      return v;
    }
    case 'MemberExpression': {
      const v = unknowVal as namedTypes.MemberExpression;
      v.property = convert(v.property);
      v.object = convert(v.object);
      return v;
    }
    case 'UpdateExpression': {
      const v = unknowVal as namedTypes.UpdateExpression;
      return v;
    }
    case 'LogicalExpression': {
      const v = unknowVal as namedTypes.LogicalExpression;
      return v;
    }
    case 'ConditionalExpression': {
      const v = unknowVal as namedTypes.ConditionalExpression;
      return v;
    }
    case 'NewExpression': {
      const v = unknowVal as namedTypes.NewExpression;
      return v;
    }
    case 'CallExpression': {
      const v = unknowVal as namedTypes.CallExpression;
      v.callee = convert(v.callee);
      convertArray(v.arguments);
      return recast.types.builders.awaitExpression.from({ argument: v });
    }
    case 'RestElement': {
      const v = unknowVal as namedTypes.RestElement;
      return v;
    }
    case 'TypeAnnotation': {
      const v = unknowVal as namedTypes.TypeAnnotation;
      return v;
    }
    case 'TSTypeAnnotation': {
      const v = unknowVal as namedTypes.TSTypeAnnotation;
      return v;
    }
    case 'SpreadElementPattern': {
      const v = unknowVal as namedTypes.SpreadElementPattern;
      return v;
    }
    case 'ArrowFunctionExpression': {
      const v = unknowVal as namedTypes.ArrowFunctionExpression;
      v.async = true;
      v.body = convert(v.body);
      return v;
    }
    case 'ForOfStatement': {
      const v = unknowVal as namedTypes.ForOfStatement;
      return v;
    }
    case 'YieldExpression': {
      const v = unknowVal as namedTypes.YieldExpression;
      return v;
    }
    case 'GeneratorExpression': {
      const v = unknowVal as namedTypes.GeneratorExpression;
      return v;
    }
    case 'ComprehensionBlock': {
      const v = unknowVal as namedTypes.ComprehensionBlock;
      return v;
    }
    case 'ComprehensionExpression': {
      const v = unknowVal as namedTypes.ComprehensionExpression;
      return v;
    }
    case 'ObjectProperty': {
      const v = unknowVal as namedTypes.ObjectProperty;
      return v;
    }
    case 'PropertyPattern': {
      const v = unknowVal as namedTypes.PropertyPattern;
      return v;
    }
    case 'ObjectPattern': {
      const v = unknowVal as namedTypes.ObjectPattern;
      return v;
    }
    case 'ArrayPattern': {
      const v = unknowVal as namedTypes.ArrayPattern;
      return v;
    }
    case 'SpreadElement': {
      const v = unknowVal as namedTypes.SpreadElement;
      return v;
    }
    case 'AssignmentPattern': {
      const v = unknowVal as namedTypes.AssignmentPattern;
      return v;
    }
    case 'MethodDefinition': {
      const v = unknowVal as namedTypes.MethodDefinition;
      return v;
    }
    case 'ClassPropertyDefinition': {
      const v = unknowVal as namedTypes.ClassPropertyDefinition;
      return v;
    }
    case 'ClassProperty': {
      const v = unknowVal as namedTypes.ClassProperty;
      return v;
    }
    case 'ClassBody': {
      const v = unknowVal as namedTypes.ClassBody;
      return v;
    }
    case 'ClassDeclaration': {
      const v = unknowVal as namedTypes.ClassDeclaration;
      return v;
    }
    case 'ClassExpression': {
      const v = unknowVal as namedTypes.ClassExpression;
      return v;
    }
    case 'Super': {
      const v = unknowVal as namedTypes.Super;
      return v;
    }
    case 'ImportSpecifier': {
      const v = unknowVal as namedTypes.ImportSpecifier;
      return v;
    }
    case 'ImportDefaultSpecifier': {
      const v = unknowVal as namedTypes.ImportDefaultSpecifier;
      return v;
    }
    case 'ImportNamespaceSpecifier': {
      const v = unknowVal as namedTypes.ImportNamespaceSpecifier;
      return v;
    }
    case 'ImportDeclaration': {
      const v = unknowVal as namedTypes.ImportDeclaration;
      return v;
    }
    case 'ExportNamedDeclaration': {
      const v = unknowVal as namedTypes.ExportNamedDeclaration;
      return v;
    }
    case 'ExportSpecifier': {
      const v = unknowVal as namedTypes.ExportSpecifier;
      return v;
    }
    case 'ExportDefaultDeclaration': {
      const v = unknowVal as namedTypes.ExportDefaultDeclaration;
      return v;
    }
    case 'ExportAllDeclaration': {
      const v = unknowVal as namedTypes.ExportAllDeclaration;
      return v;
    }
    case 'TaggedTemplateExpression': {
      const v = unknowVal as namedTypes.TaggedTemplateExpression;
      return v;
    }
    case 'TemplateLiteral': {
      const v = unknowVal as namedTypes.TemplateLiteral;
      return v;
    }
    case 'TemplateElement': {
      const v = unknowVal as namedTypes.TemplateElement;
      return v;
    }
    case 'MetaProperty': {
      const v = unknowVal as namedTypes.MetaProperty;
      return v;
    }
    case 'AwaitExpression': {
      const v = unknowVal as namedTypes.AwaitExpression;
      return v;
    }
    case 'SpreadProperty': {
      const v = unknowVal as namedTypes.SpreadProperty;
      return v;
    }
    case 'SpreadPropertyPattern': {
      const v = unknowVal as namedTypes.SpreadPropertyPattern;
      return v;
    }
    case 'ImportExpression': {
      const v = unknowVal as namedTypes.ImportExpression;
      return v;
    }
    case 'ChainExpression': {
      const v = unknowVal as namedTypes.ChainExpression;
      return v;
    }
    case 'OptionalCallExpression': {
      const v = unknowVal as namedTypes.OptionalCallExpression;
      return v;
    }
    case 'OptionalMemberExpression': {
      const v = unknowVal as namedTypes.OptionalMemberExpression;
      return v;
    }
    case 'JSXAttribute': {
      const v = unknowVal as namedTypes.JSXAttribute;
      return v;
    }
    case 'JSXIdentifier': {
      const v = unknowVal as namedTypes.JSXIdentifier;
      return v;
    }
    case 'JSXNamespacedName': {
      const v = unknowVal as namedTypes.JSXNamespacedName;
      return v;
    }
    case 'JSXExpressionContainer': {
      const v = unknowVal as namedTypes.JSXExpressionContainer;
      return v;
    }
    case 'JSXElement': {
      const v = unknowVal as namedTypes.JSXElement;
      return v;
    }
    case 'JSXFragment': {
      const v = unknowVal as namedTypes.JSXFragment;
      return v;
    }
    case 'JSXMemberExpression': {
      const v = unknowVal as namedTypes.JSXMemberExpression;
      return v;
    }
    case 'JSXSpreadAttribute': {
      const v = unknowVal as namedTypes.JSXSpreadAttribute;
      return v;
    }
    case 'JSXEmptyExpression': {
      const v = unknowVal as namedTypes.JSXEmptyExpression;
      return v;
    }
    case 'JSXText': {
      const v = unknowVal as namedTypes.JSXText;
      return v;
    }
    case 'JSXSpreadChild': {
      const v = unknowVal as namedTypes.JSXSpreadChild;
      return v;
    }
    case 'JSXOpeningElement': {
      const v = unknowVal as namedTypes.JSXOpeningElement;
      return v;
    }
    case 'JSXClosingElement': {
      const v = unknowVal as namedTypes.JSXClosingElement;
      return v;
    }
    case 'JSXOpeningFragment': {
      const v = unknowVal as namedTypes.JSXOpeningFragment;
      return v;
    }
    case 'JSXClosingFragment': {
      const v = unknowVal as namedTypes.JSXClosingFragment;
      return v;
    }
    case 'Decorator': {
      const v = unknowVal as namedTypes.Decorator;
      return v;
    }
    case 'PrivateName': {
      const v = unknowVal as namedTypes.PrivateName;
      return v;
    }
    case 'ClassPrivateProperty': {
      const v = unknowVal as namedTypes.ClassPrivateProperty;
      return v;
    }
    case 'TypeParameterDeclaration': {
      const v = unknowVal as namedTypes.TypeParameterDeclaration;
      return v;
    }
    case 'TSTypeParameterDeclaration': {
      const v = unknowVal as namedTypes.TSTypeParameterDeclaration;
      return v;
    }
    case 'TypeParameterInstantiation': {
      const v = unknowVal as namedTypes.TypeParameterInstantiation;
      return v;
    }
    case 'TSTypeParameterInstantiation': {
      const v = unknowVal as namedTypes.TSTypeParameterInstantiation;
      return v;
    }
    case 'ClassImplements': {
      const v = unknowVal as namedTypes.ClassImplements;
      return v;
    }
    case 'TSExpressionWithTypeArguments': {
      const v = unknowVal as namedTypes.TSExpressionWithTypeArguments;
      return v;
    }
    case 'AnyTypeAnnotation': {
      const v = unknowVal as namedTypes.AnyTypeAnnotation;
      return v;
    }
    case 'EmptyTypeAnnotation': {
      const v = unknowVal as namedTypes.EmptyTypeAnnotation;
      return v;
    }
    case 'MixedTypeAnnotation': {
      const v = unknowVal as namedTypes.MixedTypeAnnotation;
      return v;
    }
    case 'VoidTypeAnnotation': {
      const v = unknowVal as namedTypes.VoidTypeAnnotation;
      return v;
    }
    case 'SymbolTypeAnnotation': {
      const v = unknowVal as namedTypes.SymbolTypeAnnotation;
      return v;
    }
    case 'NumberTypeAnnotation': {
      const v = unknowVal as namedTypes.NumberTypeAnnotation;
      return v;
    }
    case 'BigIntTypeAnnotation': {
      const v = unknowVal as namedTypes.BigIntTypeAnnotation;
      return v;
    }
    case 'NumberLiteralTypeAnnotation': {
      const v = unknowVal as namedTypes.NumberLiteralTypeAnnotation;
      return v;
    }
    case 'NumericLiteralTypeAnnotation': {
      const v = unknowVal as namedTypes.NumericLiteralTypeAnnotation;
      return v;
    }
    case 'BigIntLiteralTypeAnnotation': {
      const v = unknowVal as namedTypes.BigIntLiteralTypeAnnotation;
      return v;
    }
    case 'StringTypeAnnotation': {
      const v = unknowVal as namedTypes.StringTypeAnnotation;
      return v;
    }
    case 'StringLiteralTypeAnnotation': {
      const v = unknowVal as namedTypes.StringLiteralTypeAnnotation;
      return v;
    }
    case 'BooleanTypeAnnotation': {
      const v = unknowVal as namedTypes.BooleanTypeAnnotation;
      return v;
    }
    case 'BooleanLiteralTypeAnnotation': {
      const v = unknowVal as namedTypes.BooleanLiteralTypeAnnotation;
      return v;
    }
    case 'NullableTypeAnnotation': {
      const v = unknowVal as namedTypes.NullableTypeAnnotation;
      return v;
    }
    case 'NullLiteralTypeAnnotation': {
      const v = unknowVal as namedTypes.NullLiteralTypeAnnotation;
      return v;
    }
    case 'NullTypeAnnotation': {
      const v = unknowVal as namedTypes.NullTypeAnnotation;
      return v;
    }
    case 'ThisTypeAnnotation': {
      const v = unknowVal as namedTypes.ThisTypeAnnotation;
      return v;
    }
    case 'ExistsTypeAnnotation': {
      const v = unknowVal as namedTypes.ExistsTypeAnnotation;
      return v;
    }
    case 'ExistentialTypeParam': {
      const v = unknowVal as namedTypes.ExistentialTypeParam;
      return v;
    }
    case 'FunctionTypeAnnotation': {
      const v = unknowVal as namedTypes.FunctionTypeAnnotation;
      return v;
    }
    case 'FunctionTypeParam': {
      const v = unknowVal as namedTypes.FunctionTypeParam;
      return v;
    }
    case 'ArrayTypeAnnotation': {
      const v = unknowVal as namedTypes.ArrayTypeAnnotation;
      return v;
    }
    case 'ObjectTypeAnnotation': {
      const v = unknowVal as namedTypes.ObjectTypeAnnotation;
      return v;
    }
    case 'ObjectTypeProperty': {
      const v = unknowVal as namedTypes.ObjectTypeProperty;
      return v;
    }
    case 'ObjectTypeSpreadProperty': {
      const v = unknowVal as namedTypes.ObjectTypeSpreadProperty;
      return v;
    }
    case 'ObjectTypeIndexer': {
      const v = unknowVal as namedTypes.ObjectTypeIndexer;
      return v;
    }
    case 'ObjectTypeCallProperty': {
      const v = unknowVal as namedTypes.ObjectTypeCallProperty;
      return v;
    }
    case 'ObjectTypeInternalSlot': {
      const v = unknowVal as namedTypes.ObjectTypeInternalSlot;
      return v;
    }
    case 'Variance': {
      const v = unknowVal as namedTypes.Variance;
      return v;
    }
    case 'QualifiedTypeIdentifier': {
      const v = unknowVal as namedTypes.QualifiedTypeIdentifier;
      return v;
    }
    case 'GenericTypeAnnotation': {
      const v = unknowVal as namedTypes.GenericTypeAnnotation;
      return v;
    }
    case 'MemberTypeAnnotation': {
      const v = unknowVal as namedTypes.MemberTypeAnnotation;
      return v;
    }
    case 'UnionTypeAnnotation': {
      const v = unknowVal as namedTypes.UnionTypeAnnotation;
      return v;
    }
    case 'IntersectionTypeAnnotation': {
      const v = unknowVal as namedTypes.IntersectionTypeAnnotation;
      return v;
    }
    case 'TypeofTypeAnnotation': {
      const v = unknowVal as namedTypes.TypeofTypeAnnotation;
      return v;
    }
    case 'TypeParameter': {
      const v = unknowVal as namedTypes.TypeParameter;
      return v;
    }
    case 'InterfaceTypeAnnotation': {
      const v = unknowVal as namedTypes.InterfaceTypeAnnotation;
      return v;
    }
    case 'InterfaceExtends': {
      const v = unknowVal as namedTypes.InterfaceExtends;
      return v;
    }
    case 'InterfaceDeclaration': {
      const v = unknowVal as namedTypes.InterfaceDeclaration;
      return v;
    }
    case 'DeclareInterface': {
      const v = unknowVal as namedTypes.DeclareInterface;
      return v;
    }
    case 'TypeAlias': {
      const v = unknowVal as namedTypes.TypeAlias;
      return v;
    }
    case 'DeclareTypeAlias': {
      const v = unknowVal as namedTypes.DeclareTypeAlias;
      return v;
    }
    case 'OpaqueType': {
      const v = unknowVal as namedTypes.OpaqueType;
      return v;
    }
    case 'DeclareOpaqueType': {
      const v = unknowVal as namedTypes.DeclareOpaqueType;
      return v;
    }
    case 'TypeCastExpression': {
      const v = unknowVal as namedTypes.TypeCastExpression;
      return v;
    }
    case 'TupleTypeAnnotation': {
      const v = unknowVal as namedTypes.TupleTypeAnnotation;
      return v;
    }
    case 'DeclareVariable': {
      const v = unknowVal as namedTypes.DeclareVariable;
      return v;
    }
    case 'DeclareFunction': {
      const v = unknowVal as namedTypes.DeclareFunction;
      return v;
    }
    case 'DeclareClass': {
      const v = unknowVal as namedTypes.DeclareClass;
      return v;
    }
    case 'DeclareModule': {
      const v = unknowVal as namedTypes.DeclareModule;
      return v;
    }
    case 'DeclareModuleExports': {
      const v = unknowVal as namedTypes.DeclareModuleExports;
      return v;
    }
    case 'DeclareExportDeclaration': {
      const v = unknowVal as namedTypes.DeclareExportDeclaration;
      return v;
    }
    case 'ExportBatchSpecifier': {
      const v = unknowVal as namedTypes.ExportBatchSpecifier;
      return v;
    }
    case 'DeclareExportAllDeclaration': {
      const v = unknowVal as namedTypes.DeclareExportAllDeclaration;
      return v;
    }
    case 'InferredPredicate': {
      const v = unknowVal as namedTypes.InferredPredicate;
      return v;
    }
    case 'DeclaredPredicate': {
      const v = unknowVal as namedTypes.DeclaredPredicate;
      return v;
    }
    case 'EnumDeclaration': {
      const v = unknowVal as namedTypes.EnumDeclaration;
      return v;
    }
    case 'ExportDeclaration': {
      const v = unknowVal as namedTypes.ExportDeclaration;
      return v;
    }
    case 'Block': {
      const v = unknowVal as namedTypes.Block;
      return v;
    }
    case 'Line': {
      const v = unknowVal as namedTypes.Line;
      return v;
    }
    case 'Noop': {
      const v = unknowVal as namedTypes.Noop;
      return v;
    }
    case 'DoExpression': {
      const v = unknowVal as namedTypes.DoExpression;
      return v;
    }
    case 'BindExpression': {
      const v = unknowVal as namedTypes.BindExpression;
      return v;
    }
    case 'ParenthesizedExpression': {
      const v = unknowVal as namedTypes.ParenthesizedExpression;
      return v;
    }
    case 'ExportNamespaceSpecifier': {
      const v = unknowVal as namedTypes.ExportNamespaceSpecifier;
      return v;
    }
    case 'ExportDefaultSpecifier': {
      const v = unknowVal as namedTypes.ExportDefaultSpecifier;
      return v;
    }
    case 'CommentBlock': {
      const v = unknowVal as namedTypes.CommentBlock;
      return v;
    }
    case 'CommentLine': {
      const v = unknowVal as namedTypes.CommentLine;
      return v;
    }
    case 'Directive': {
      const v = unknowVal as namedTypes.Directive;
      return v;
    }
    case 'DirectiveLiteral': {
      const v = unknowVal as namedTypes.DirectiveLiteral;
      return v;
    }
    case 'InterpreterDirective': {
      const v = unknowVal as namedTypes.InterpreterDirective;
      return v;
    }
    case 'StringLiteral': {
      const v = unknowVal as namedTypes.StringLiteral;
      return v;
    }
    case 'NumericLiteral': {
      const v = unknowVal as namedTypes.NumericLiteral;
      return v;
    }
    case 'BigIntLiteral': {
      const v = unknowVal as namedTypes.BigIntLiteral;
      return v;
    }
    case 'NullLiteral': {
      const v = unknowVal as namedTypes.NullLiteral;
      return v;
    }
    case 'BooleanLiteral': {
      const v = unknowVal as namedTypes.BooleanLiteral;
      return v;
    }
    case 'RegExpLiteral': {
      const v = unknowVal as namedTypes.RegExpLiteral;
      return v;
    }
    case 'ObjectMethod': {
      const v = unknowVal as namedTypes.ObjectMethod;
      return v;
    }
    case 'ClassMethod': {
      const v = unknowVal as namedTypes.ClassMethod;
      return v;
    }
    case 'ClassPrivateMethod': {
      const v = unknowVal as namedTypes.ClassPrivateMethod;
      return v;
    }
    case 'RestProperty': {
      const v = unknowVal as namedTypes.RestProperty;
      return v;
    }
    case 'ForAwaitStatement': {
      const v = unknowVal as namedTypes.ForAwaitStatement;
      return v;
    }
    case 'Import': {
      const v = unknowVal as namedTypes.Import;
      return v;
    }
    case 'TSQualifiedName': {
      const v = unknowVal as namedTypes.TSQualifiedName;
      return v;
    }
    case 'TSTypeReference': {
      const v = unknowVal as namedTypes.TSTypeReference;
      return v;
    }
    case 'TSAsExpression': {
      const v = unknowVal as namedTypes.TSAsExpression;
      return v;
    }
    case 'TSNonNullExpression': {
      const v = unknowVal as namedTypes.TSNonNullExpression;
      return v;
    }
    case 'TSAnyKeyword': {
      const v = unknowVal as namedTypes.TSAnyKeyword;
      return v;
    }
    case 'TSBigIntKeyword': {
      const v = unknowVal as namedTypes.TSBigIntKeyword;
      return v;
    }
    case 'TSBooleanKeyword': {
      const v = unknowVal as namedTypes.TSBooleanKeyword;
      return v;
    }
    case 'TSNeverKeyword': {
      const v = unknowVal as namedTypes.TSNeverKeyword;
      return v;
    }
    case 'TSNullKeyword': {
      const v = unknowVal as namedTypes.TSNullKeyword;
      return v;
    }
    case 'TSNumberKeyword': {
      const v = unknowVal as namedTypes.TSNumberKeyword;
      return v;
    }
    case 'TSObjectKeyword': {
      const v = unknowVal as namedTypes.TSObjectKeyword;
      return v;
    }
    case 'TSStringKeyword': {
      const v = unknowVal as namedTypes.TSStringKeyword;
      return v;
    }
    case 'TSSymbolKeyword': {
      const v = unknowVal as namedTypes.TSSymbolKeyword;
      return v;
    }
    case 'TSUndefinedKeyword': {
      const v = unknowVal as namedTypes.TSUndefinedKeyword;
      return v;
    }
    case 'TSUnknownKeyword': {
      const v = unknowVal as namedTypes.TSUnknownKeyword;
      return v;
    }
    case 'TSVoidKeyword': {
      const v = unknowVal as namedTypes.TSVoidKeyword;
      return v;
    }
    case 'TSThisType': {
      const v = unknowVal as namedTypes.TSThisType;
      return v;
    }
    case 'TSArrayType': {
      const v = unknowVal as namedTypes.TSArrayType;
      return v;
    }
    case 'TSLiteralType': {
      const v = unknowVal as namedTypes.TSLiteralType;
      return v;
    }
    case 'TSUnionType': {
      const v = unknowVal as namedTypes.TSUnionType;
      return v;
    }
    case 'TSIntersectionType': {
      const v = unknowVal as namedTypes.TSIntersectionType;
      return v;
    }
    case 'TSConditionalType': {
      const v = unknowVal as namedTypes.TSConditionalType;
      return v;
    }
    case 'TSInferType': {
      const v = unknowVal as namedTypes.TSInferType;
      return v;
    }
    case 'TSTypeParameter': {
      const v = unknowVal as namedTypes.TSTypeParameter;
      return v;
    }
    case 'TSParenthesizedType': {
      const v = unknowVal as namedTypes.TSParenthesizedType;
      return v;
    }
    case 'TSFunctionType': {
      const v = unknowVal as namedTypes.TSFunctionType;
      return v;
    }
    case 'TSConstructorType': {
      const v = unknowVal as namedTypes.TSConstructorType;
      return v;
    }
    case 'TSDeclareFunction': {
      const v = unknowVal as namedTypes.TSDeclareFunction;
      return v;
    }
    case 'TSDeclareMethod': {
      const v = unknowVal as namedTypes.TSDeclareMethod;
      return v;
    }
    case 'TSMappedType': {
      const v = unknowVal as namedTypes.TSMappedType;
      return v;
    }
    case 'TSTupleType': {
      const v = unknowVal as namedTypes.TSTupleType;
      return v;
    }
    case 'TSNamedTupleMember': {
      const v = unknowVal as namedTypes.TSNamedTupleMember;
      return v;
    }
    case 'TSRestType': {
      const v = unknowVal as namedTypes.TSRestType;
      return v;
    }
    case 'TSOptionalType': {
      const v = unknowVal as namedTypes.TSOptionalType;
      return v;
    }
    case 'TSIndexedAccessType': {
      const v = unknowVal as namedTypes.TSIndexedAccessType;
      return v;
    }
    case 'TSTypeOperator': {
      const v = unknowVal as namedTypes.TSTypeOperator;
      return v;
    }
    case 'TSIndexSignature': {
      const v = unknowVal as namedTypes.TSIndexSignature;
      return v;
    }
    case 'TSPropertySignature': {
      const v = unknowVal as namedTypes.TSPropertySignature;
      return v;
    }
    case 'TSMethodSignature': {
      const v = unknowVal as namedTypes.TSMethodSignature;
      return v;
    }
    case 'TSTypePredicate': {
      const v = unknowVal as namedTypes.TSTypePredicate;
      return v;
    }
    case 'TSCallSignatureDeclaration': {
      const v = unknowVal as namedTypes.TSCallSignatureDeclaration;
      return v;
    }
    case 'TSConstructSignatureDeclaration': {
      const v = unknowVal as namedTypes.TSConstructSignatureDeclaration;
      return v;
    }
    case 'TSEnumMember': {
      const v = unknowVal as namedTypes.TSEnumMember;
      return v;
    }
    case 'TSTypeQuery': {
      const v = unknowVal as namedTypes.TSTypeQuery;
      return v;
    }
    case 'TSImportType': {
      const v = unknowVal as namedTypes.TSImportType;
      return v;
    }
    case 'TSTypeLiteral': {
      const v = unknowVal as namedTypes.TSTypeLiteral;
      return v;
    }
    case 'TSTypeAssertion': {
      const v = unknowVal as namedTypes.TSTypeAssertion;
      return v;
    }
    case 'TSEnumDeclaration': {
      const v = unknowVal as namedTypes.TSEnumDeclaration;
      return v;
    }
    case 'TSTypeAliasDeclaration': {
      const v = unknowVal as namedTypes.TSTypeAliasDeclaration;
      return v;
    }
    case 'TSModuleBlock': {
      const v = unknowVal as namedTypes.TSModuleBlock;
      return v;
    }
    case 'TSModuleDeclaration': {
      const v = unknowVal as namedTypes.TSModuleDeclaration;
      return v;
    }
    case 'TSImportEqualsDeclaration': {
      const v = unknowVal as namedTypes.TSImportEqualsDeclaration;
      return v;
    }
    case 'TSExternalModuleReference': {
      const v = unknowVal as namedTypes.TSExternalModuleReference;
      return v;
    }
    case 'TSExportAssignment': {
      const v = unknowVal as namedTypes.TSExportAssignment;
      return v;
    }
    case 'TSNamespaceExportDeclaration': {
      const v = unknowVal as namedTypes.TSNamespaceExportDeclaration;
      return v;
    }
    case 'TSInterfaceBody': {
      const v = unknowVal as namedTypes.TSInterfaceBody;
      return v;
    }
    case 'TSInterfaceDeclaration': {
      const v = unknowVal as namedTypes.TSInterfaceDeclaration;
      return v;
    }
    case 'TSParameterProperty': {
      const v = unknowVal as namedTypes.TSParameterProperty;
      return v;
    }
    case 'SourceLocation': {
      const v = unknowVal as namedTypes.SourceLocation;
      return v;
    }
    case 'Position': {
      const v = unknowVal as namedTypes.Position;
      return v;
    }
    case 'EnumBooleanBody': {
      const v = unknowVal as namedTypes.EnumBooleanBody;
      return v;
    }
    case 'EnumNumberBody': {
      const v = unknowVal as namedTypes.EnumNumberBody;
      return v;
    }
    case 'EnumStringBody': {
      const v = unknowVal as namedTypes.EnumStringBody;
      return v;
    }
    case 'EnumSymbolBody': {
      const v = unknowVal as namedTypes.EnumSymbolBody;
      return v;
    }
    case 'EnumBooleanMember': {
      const v = unknowVal as namedTypes.EnumBooleanMember;
      return v;
    }
    case 'EnumNumberMember': {
      const v = unknowVal as namedTypes.EnumNumberMember;
      return v;
    }
    case 'EnumStringMember': {
      const v = unknowVal as namedTypes.EnumStringMember;
      return v;
    }
    case 'EnumDefaultedMember': {
      const v = unknowVal as namedTypes.EnumDefaultedMember;
      return v;
    }
    default:
      return unknowVal;
  }
}
