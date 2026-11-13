// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { DeployMiyaPoolV2 } from "../../script/DeployMiyaPoolV2.s.sol";
import { MiyaPoolFactory } from "../../src/pools/MiyaPoolFactory.sol";

contract DeployMiyaPoolV2Harness is DeployMiyaPoolV2 {
    function priorFactory(string memory json) external view returns (address) {
        return _priorFactory(json);
    }
}

/// @dev A v1-like factory: code, no vault(), no fallback.
contract V1Like {
    function allPoolsLength() external pure returns (uint256) {
        return 0;
    }
}

/// @notice The deployments-JSON rules of script/DeployMiyaPoolV2.s.sol: works with no v1, and never records a v2
///         factory as `miyaPoolFactoryV1`.
contract DeployMiyaPoolV2Test is Test {
    DeployMiyaPoolV2Harness h = new DeployMiyaPoolV2Harness();

    function _json(string memory key, address a) internal pure returns (string memory) {
        return string.concat('{"chainId":1,"', key, '":"', vm.toString(a), '"}');
    }

    function test_noV1Key_returnsZero() public view {
        assertEq(h.priorFactory('{"chainId":1}'), address(0));
    }

    function test_v1Factory_returned() public {
        address v1 = address(new V1Like());
        assertEq(h.priorFactory(_json("miyaPoolFactory", v1)), v1);
    }

    function test_v1WithoutCode_returned() public {
        address v1 = makeAddr("v1");
        assertEq(h.priorFactory(_json("miyaPoolFactory", v1)), v1);
    }

    function test_refusesWhenV2AlreadyRecorded() public {
        address v2 = address(new MiyaPoolFactory(address(0)));
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMiyaPoolV2.ConfigError.selector, "miyaPoolFactory in deployments json is already a v2 factory"
            )
        );
        h.priorFactory(_json("miyaPoolFactory", v2));
    }

    function test_refusesWhenV1KeyExists() public {
        string memory json = string.concat(
            '{"miyaPoolFactory":"',
            vm.toString(makeAddr("v2")),
            '","miyaPoolFactoryV1":"',
            vm.toString(makeAddr("v1")),
            '"}'
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMiyaPoolV2.ConfigError.selector,
                "deployments json already records miyaPoolFactoryV1: v2 is already deployed here"
            )
        );
        h.priorFactory(json);
    }
}
