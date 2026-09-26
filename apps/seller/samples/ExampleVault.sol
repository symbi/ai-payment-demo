// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Bundled teaching sample. Not deployed, audited, or suitable for holding funds.
contract ExampleVault {
    address public owner;
    mapping(address => uint256) private balances;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        balances[msg.sender] -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "zero address");
        owner = nextOwner;
    }
}
